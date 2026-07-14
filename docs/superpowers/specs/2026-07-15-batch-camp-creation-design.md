# Batch camp creation — design

**Date:** 2026-07-15
**Scope:** Backend (new batch write) **and** Frontend (wizard commit collapses to one call).
**Status:** approved
**Branches:** Backend `feat/batch-camp-create` (off `dev`); Frontend follow-up branch (off `dev`).

## Problem

The camp-creation wizard commits its draft with a **client-orchestrated sequence** —
`create camp → create each group → add each participant → publish` — because the API
only exposes per-entity routes. That works but pushes consistency onto the client:
`useCommitCampDraft` carries a resumable "progress ledger" (real campId, tempId→realId
group map, added-participant tracking) so a mid-sequence network failure can retry
without duplicating. N+2 round-trips on weak camp networks (a Camply guardrail) means
N+2 failure points, and a half-built camp can litter the server if the user abandons.

The fix: one endpoint that accepts the whole camp aggregate (camp + groups +
participants) and owns consistency server-side. The frontend collapses to a single
call and deletes the ledger.

## Backend reality (constrains the approach)

- **MongoDB + Mongoose 9.** Multi-document transactions require a **replica set**.
  `.env` points at **Atlas** (`mongodb+srv://…` — a replica set, transactions
  available), but `.env.example` and any standalone `mongod` are **not**. We keep the
  design portable (no replica-set dependency); a transaction wrapper is a trivial
  future upgrade on Atlas.
- **Create paths carry side-effects that must be preserved (reuse the services):**
  - `campService.create` also seeds the creator's `projectManager` `Membership`.
  - `groupService.create` also seeds a `GroupPoints` leaderboard row.
  - `rosterService.add` canonicalizes the phone (so claim-on-login matches),
    enforces ≤2 participant-camps per phone, and maps the `{campId,phone}` unique
    collision to a clean 409.
- **`campService.remove` doesn't cascade to groups/GroupPoints** (only camp +
  memberships) — a latent gap that the rollback path exposes; fixed here.
- **Layering (follow exactly):** `routes → controllers → services → models`;
  thin controllers (no try/catch); `HttpError`; Zod validators from `config/zod`;
  OpenAPI `registry.registerPath` per endpoint.

## Decisions (locked)

- **Consistency: validate-first + compensating cleanup** (not a transaction).
  Pre-validate everything before any write, so bad input rejects cleanly with the
  offending row and nothing is written. Only rare post-write infra errors trigger a
  cleanup that deletes the camp + its groups + GroupPoints + memberships. Portable to
  standalone and Atlas alike. Source of truth for the DB is `.env`, not `.env.example`.
- **Retry safety: `clientRequestId` dedupe.** The wizard's persisted draft holds a
  stable uuid; the backend stores it unique-sparse on the `Camp`. A retry with the
  same id returns the existing camp instead of creating a duplicate.
- **Route: extend `POST /organizer/camps`** (backward-compatible), not a new path.
  `groups`/`participants`/`status`/`clientRequestId` are all optional; omitting them
  is exactly today's create. `publish` folds in via `status: 'published'`.
- **Participant→group linkage: client `ref`.** Groups carry a client `ref`;
  participants reference `groupRef` (or `null` = unassigned). Maps 1:1 to the store's
  `tempId`/`groupTempId`, so the frontend transform is trivial. Backend resolves
  `ref → _id` after inserting groups.

## Backend design

### Request body (extended `createCampSchema`)

```ts
{
  name: string
  location: string
  startsAt: string   // ISO datetime
  endsAt: string     // ISO datetime
  capacity?: number
  languages?: ('en'|'uz'|'ru')[]
  coverImage?: string | null
  status?: 'draft' | 'published'          // default 'draft'
  clientRequestId?: string                // uuid; dedupe key
  groups?: { ref: string; name: string; color: string }[]
  participants?: { phone: string; groupRef: string | null }[]
}
```

Zod cross-field rules (reject before any service call):
- group `ref`s are unique within the payload;
- every `participant.groupRef` is `null` or matches a declared group `ref`;
- `phone` matches the existing phone shape; `color`/`name` non-empty.

### `Camp` model change

Add `clientRequestId: { type: String, default: null }` with a **unique + sparse**
index (`{ clientRequestId: 1 }, { unique: true, sparse: true }`). Sparse so the many
camps without one don't collide on `null`.

### Service: `campService.createFull(input, creator)`

Orchestrates, reusing existing services:

1. **Dedupe:** if `input.clientRequestId` and a `Camp` already has it → return
   `{ camp: toOrganizerCamp(existing), created: false }` (no writes).
2. **Validate-first (read-only):**
   - resolve `organizationId` (existing single-org logic);
   - canonicalize every participant phone;
   - reject intra-payload duplicate phones → `HttpError(409, …which phone)`;
   - for each phone, `membershipService.countParticipantCamps(phone)` and reject if
     already ≥2 → `HttpError(409, …)`.
   - No writes have happened yet.
3. **Write:**
   - `campService.create(input, creator)` — extended to accept `status` +
     `clientRequestId` (defaults preserve today's behavior);
   - for each group in order: `groupService.create(campId, {name,color})`, record
     `ref → group.id`;
   - for each participant: resolve `groupRef → groupId` (null passes through),
     `rosterService.add(campId, phone, groupId)`.
   - (`status:'published'` is applied by `campService.create` writing `status`
     directly, so no separate publish round-trip.)
4. **Compensating cleanup on any thrown error in step 3:** `campService.purge(campId)`
   then rethrow the original error.
5. Return `{ camp, created: true }`.

Because step 2 catches the common failures pre-write, step 3 throws only on infra
errors — the small window the cleanup covers.

### Service: `campService.purge(campId)` (rollback cascade)

Deletes, in order: memberships, GroupPoints rows, groups, then the camp itself —
the full cascade today's `remove` lacks. The public `DELETE /organizer/camps/:id`
keeps its **draft-only** guard (`remove` stays as the guarded public path, delegating
its cascade to `purge`); `purge` itself is unguarded (internal rollback + the
draft-guarded caller).

### Controller

`createCamp` stays thin:

```ts
const { camp, created } = await campService.createFull(req.body, req.auth!.user)
res.status(created ? 201 : 200).json(camp)
```

### Docs

Update the `POST /organizer/camps` `registry.registerPath` body to the extended
schema (reuse the Zod schema so docs can't drift).

## Frontend design

- **`campsService.createFull(payload)`** — new typed method hitting `POST
  /organizer/camps` with the batch body; returns `OrganizerCamp`.
- **`useCommitCampDraft` collapses** to building one payload from the store and a
  single `createFull` call:
  - `groups → { ref: tempId, name, color }`
  - `participants → { phone, groupRef: groupTempId }`
  - `status: 'published'`, `clientRequestId` from the store.
  - On success: invalidate `organizerKeys.camps`/`summary`, `reset()`, return campId.
- **`useCampDraftStore` simplifies:**
  - Add persisted `clientRequestId: string` (init `crypto.randomUUID()`; `reset()`
    generates a fresh one). Persisted, so a refresh keeps the same id → retry-safe.
  - **Delete the `progress` ledger** (`campId`, `groupIdMap`,
    `addedParticipantTempIds`, `published`) and its setters (`setCampId`,
    `mapGroupId`, `markParticipantAdded`, `markPublished`). Keep `info`, `groups`,
    `participants`, and the collection actions.
- **`CampWizard` unchanged** in behavior: the Finish button still calls the commit
  mutation; error/retry UI stays. A retry re-sends the same payload; `clientRequestId`
  makes it idempotent (server returns the existing camp).

## Files

**Backend — new/edited**
- `src/models/camp.model.ts` — `clientRequestId` field + unique-sparse index.
- `src/validators/camp.validators.ts` — extend `createCampSchema` (+ cross-field rules).
- `src/services/camp.services.ts` — `createFull`, `purge`; `create` accepts
  `status`/`clientRequestId`; `remove` delegates to `purge`.
- `src/controllers/camp.controllers.ts` — `createCamp` returns 201/200 via `created`.
- `src/docs/openapi.ts` — updated `POST /organizer/camps` body.

**Frontend — edited**
- `src/api/services/camps.service.ts` — `createFull` + batch body types.
- `src/api/queries/campDraft.queries.ts` — collapse `useCommitCampDraft`.
- `src/store/useCampDraftStore.ts` — add `clientRequestId`, drop `progress`.
- `frontend/CLAUDE.md` + `backend/CLAUDE.md` — note the batch endpoint + simplified wizard.

## Non-goals

- No Mongo transaction (portable validate-first instead; transaction is a later
  upgrade on Atlas).
- No dedicated idempotency **collection** (the unique-sparse `clientRequestId` on the
  camp is enough at launch scale).
- Per-entity routes (`…/groups`, `…/roster`, `…/publish`) **stay** — the camp-detail
  and roster screens still use them for incremental edits after creation.

## Tradeoffs named

- **Validate-first ≠ true atomicity.** A hard crash *between* a write and the
  compensating cleanup could orphan a partial camp. The window is tiny (only infra
  errors reach step 3), and `clientRequestId` makes the retry return-or-resume-safe.
  Acceptable at bounded scale; upgrade to a transaction on Atlas if it ever matters.
- **This supersedes the client-orchestrated `useCommitCampDraft`** shipped as the
  backend-untouched stopgap — that ledger is deleted here.
