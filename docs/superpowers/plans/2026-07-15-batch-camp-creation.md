# Batch Camp Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `POST /organizer/camps` accept the whole camp aggregate (camp + groups + participants) in one request, so the wizard commits with a single call and drops its client-side orchestration ledger.

**Architecture:** Backend adds `campService.createFull` — dedupe by `clientRequestId`, validate everything first, then write via the existing `campService.create`/`groupService.create`/`rosterService.add` (preserving their side-effects), with a compensating `campService.purge` on any post-write error. Frontend collapses `useCommitCampDraft` to one `campsService.createFull` call and simplifies the draft store.

**Tech Stack:** Backend — Express 5, Mongoose 9 (MongoDB/Atlas), Zod 4, TypeScript (strict, CommonJS). Frontend — React 19, TypeScript, Zustand + persist, TanStack Query.

## Global Constraints

- **Two repos.** Backend: `/Users/mn.afridi/Desktop/Camply/Backend` on branch `feat/batch-camp-create`. Frontend: `/Users/mn.afridi/Desktop/Camply/Frontend` — create branch `feat/batch-camp-create` off `dev` before Phase B.
- **No test runners** (both repos, project preference). Do NOT add tests. Verification is `npm run validate` per repo + the described curl/build/runtime check.
- **`.env` is the source of truth** for `MONGO_URI` (Atlas, a replica set) — not `.env.example`. The design deliberately avoids depending on transactions anyway.
- **Backend layering:** `routes → controllers → services → models`; thin controllers (no try/catch — Express 5 forwards async throws); throw `HttpError(status, message)`; **import `z` from `config/zod`** (never `'zod'`); add/adjust `registry.registerPath` in `docs/openapi.ts` for endpoint changes.
- **Reuse existing services** in `createFull` — do NOT re-implement membership seeding, GroupPoints seeding, phone canonicalization, or the ≤2-camp / 409 logic.
- **Prettier** (both): no semicolons, single quotes, trailing commas, width 100. Format touched files: backend `npx prettier --write "src/**/…"`; frontend `npx prettier --write --end-of-line auto <files>`.
- **Frontend:** `import type { … }` for type-only imports; design tokens only; components call query hooks only.
- **Commit trailer** (both): end each commit body with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**Backend (edited)**
- `src/models/camp.model.ts` — `clientRequestId` field + unique-sparse index.
- `src/validators/camp.validators.ts` — split core object; extended+refined create schema.
- `src/services/camp.services.ts` — `create` accepts `status`/`clientRequestId`; new `purge`; `remove` delegates; new `createFull`.
- `src/controllers/camp.controllers.ts` — `createCamp` returns 201/200.
- `src/docs/openapi.ts` — updated create summary.
- `CLAUDE.md` — batch endpoint note.

**Frontend (edited)**
- `src/api/services/camps.service.ts` — `createFull` + batch body types.
- `src/store/useCampDraftStore.ts` — add `clientRequestId`, drop `progress` ledger.
- `src/api/queries/campDraft.queries.ts` — collapse `useCommitCampDraft`.
- `CLAUDE.md` — simplified wizard note.

---

# Phase A — Backend

## Task 1: Camp model — `clientRequestId`

**Files:**
- Modify: `src/models/camp.model.ts`

**Interfaces:**
- Produces: `Camp.clientRequestId: string | null`; unique-sparse index on it.

- [ ] **Step 1: Add the field**

In `campSchema`, after the `status` line, add:

```ts
    clientRequestId: { type: String, default: null }, // idempotency key for batch create
```

- [ ] **Step 2: Add the unique-sparse index**

After the schema definition, before `export type Camp`, add:

```ts
// Retry-safe batch create: a repeat with the same key returns the existing camp.
campSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true })
```

- [ ] **Step 3: Validate**

Run: `cd /Users/mn.afridi/Desktop/Camply/Backend && npm run validate`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/mn.afridi/Desktop/Camply/Backend
npx prettier --write "src/models/camp.model.ts"
git add src/models/camp.model.ts
git commit -m "feat(camp): add clientRequestId for batch-create dedupe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Validators — extended create schema

**Files:**
- Modify: `src/validators/camp.validators.ts`
- Modify: `src/docs/openapi.ts` (register the object, not the effect)

**Interfaces:**
- Produces: `createCampObject` (plain object, for docs), `createCampSchema` (object + `superRefine`, for validation), `updateCampSchema` (core `.partial()`, unchanged semantics — no batch fields).

- [ ] **Step 1: Rewrite the validators**

Replace the body of `src/validators/camp.validators.ts` (keep the `campIdParam` export as-is) so the create schema splits into a reusable core plus the batch extension:

```ts
import { z } from '../config/zod'

export const campIdParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
})

// Core camp fields — shared by create and (partial) update.
const campCoreSchema = z.object({
  name: z.string().min(1),
  location: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  capacity: z.number().int().nonnegative().optional(),
  languages: z.array(z.enum(['en', 'uz', 'ru'])).optional(),
  coverImage: z.string().url().nullable().optional(),
})

// Create accepts the optional batch payload (groups + participants) and a status.
// Registered for OpenAPI as the plain object below; the refined version is used for
// request validation (a ZodEffects can't be .register()'d/.partial()'d cleanly).
export const createCampObject = campCoreSchema.extend({
  status: z.enum(['draft', 'published']).optional(),
  clientRequestId: z.string().min(1).optional(),
  groups: z
    .array(
      z.object({ ref: z.string().min(1), name: z.string().min(1), color: z.string().min(1) }),
    )
    .optional(),
  participants: z
    .array(z.object({ phone: z.string().min(1), groupRef: z.string().min(1).nullable() }))
    .optional(),
})

export const createCampSchema = createCampObject.superRefine((data, ctx) => {
  const refs = new Set<string>()
  for (const g of data.groups ?? []) {
    if (refs.has(g.ref)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate group ref: ${g.ref}`, path: ['groups'] })
    }
    refs.add(g.ref)
  }
  ;(data.participants ?? []).forEach((p, i) => {
    if (p.groupRef !== null && !refs.has(p.groupRef)) {
      ctx.addIssue({
        code: 'custom',
        message: `Participant ${i} references unknown group ref: ${p.groupRef}`,
        path: ['participants', i, 'groupRef'],
      })
    }
  })
})

// PATCH stays camp-core only — no batch fields, no status/clientRequestId.
export const updateCampSchema = campCoreSchema.partial()
```

- [ ] **Step 2: Point OpenAPI at the object**

In `src/docs/openapi.ts`, update the import (line ~9) and the registered input (line ~78):

```ts
import { createCampObject, updateCampSchema, campIdParam } from '../validators/camp.validators'
```
```ts
const CreateCampInput = registry.register('CreateCampInput', createCampObject)
```

(`createCampSchema` is still imported by the route via the validate middleware — leave `camp.routes.ts` importing `createCampSchema`; only `openapi.ts` switches to `createCampObject`.)

- [ ] **Step 3: Validate**

Run: `cd /Users/mn.afridi/Desktop/Camply/Backend && npm run validate`
Expected: PASS. If `tsc` reports `updateCampSchema.partial` or a `.register` type error, confirm `openapi.ts` imports `createCampObject` (not the refined schema).

- [ ] **Step 4: Commit**

```bash
cd /Users/mn.afridi/Desktop/Camply/Backend
npx prettier --write "src/validators/camp.validators.ts" "src/docs/openapi.ts"
git add src/validators/camp.validators.ts src/docs/openapi.ts
git commit -m "feat(camp): accept optional groups/participants/status in create schema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Service — `create` extension, `purge`, `remove` delegate

**Files:**
- Modify: `src/services/camp.services.ts`

**Interfaces:**
- Consumes: `GroupPointsModel` (from `models/leaderboard.model`).
- Produces: `CreateInput` gains `status?`/`clientRequestId?`; `campService.purge(campId)`; `campService.remove` delegates to `purge`.

- [ ] **Step 1: Import GroupPointsModel**

Add to the imports at the top of `src/services/camp.services.ts`:

```ts
import { GroupPointsModel } from '../models/leaderboard.model'
```

- [ ] **Step 2: Extend `CreateInput`**

Add two optional fields to the `CreateInput` type:

```ts
type CreateInput = {
  name: string
  location: string
  startsAt: string
  endsAt: string
  capacity?: number
  languages?: string[]
  coverImage?: string | null
  status?: 'draft' | 'published'
  clientRequestId?: string
}
```

- [ ] **Step 3: Honor `status`/`clientRequestId` in `create`**

In `campService.create`, change the `CampModel.create({...})` call so status is driven by input and the dedupe key is stored:

```ts
    const camp = await CampModel.create({
      ...input,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      status: input.status ?? 'draft',
      clientRequestId: input.clientRequestId ?? null,
      createdBy: creator._id,
      organizationId,
    })
```

- [ ] **Step 4: Add `purge` and delegate `remove`**

Replace the existing `remove` method with a `purge` (full cascade) + a `remove` that guards then delegates:

```ts
  // Full cascade — used by the batch-create rollback and by the guarded public remove.
  purge: async (campId: Camp['_id']) => {
    await MembershipModel.deleteMany({ campId })
    await GroupPointsModel.deleteMany({ campId })
    await GroupModel.deleteMany({ campId })
    await CampModel.deleteOne({ _id: campId })
  },

  remove: async (camp: Camp) => {
    if (camp.status !== 'draft') throw new HttpError(409, 'Only draft camps can be deleted')
    await campService.purge(camp._id)
  },
```

- [ ] **Step 5: Validate**

Run: `cd /Users/mn.afridi/Desktop/Camply/Backend && npm run validate`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/mn.afridi/Desktop/Camply/Backend
npx prettier --write "src/services/camp.services.ts"
git add src/services/camp.services.ts
git commit -m "feat(camp): status/clientRequestId in create; purge cascade for rollback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Service — `createFull`

**Files:**
- Modify: `src/services/camp.services.ts`

**Interfaces:**
- Consumes: `groupService.create`, `rosterService.add`, `membershipService.countParticipantCamps`, `canonicalizePhone`, `Types` (mongoose), `campService.create`/`purge`/`toOrganizerCamp`.
- Produces: `campService.createFull(input, creator) → { camp, created: boolean }`.

- [ ] **Step 1: Add imports**

At the top of `src/services/camp.services.ts` add:

```ts
import { Types } from 'mongoose'
import { groupService } from './group.services'
import { rosterService } from './roster.services'
import { membershipService } from './membership.services'
import { canonicalizePhone } from '../utils/phone'
```

(These services do not import `camp.services`, so there is no import cycle.)

- [ ] **Step 2: Add the `CreateFullInput` type**

Below the `CreateInput` type, add:

```ts
type CreateFullInput = CreateInput & {
  groups?: { ref: string; name: string; color: string }[]
  participants?: { phone: string; groupRef: string | null }[]
}
```

- [ ] **Step 3: Add `createFull` to `campService`**

Add this method (e.g. right after `create`):

```ts
  // One-shot batch create: dedupe → validate-first → write (reusing the per-entity
  // services) → compensating purge on any post-write error. No DB transaction, so it
  // stays portable across standalone/replica-set MongoDB.
  createFull: async (input: CreateFullInput, creator: HydratedDocument<User>) => {
    const { groups = [], participants = [], ...campInput } = input

    // 1. Dedupe — a retry with the same key returns the existing camp, no writes.
    if (campInput.clientRequestId) {
      const existing = await CampModel.findOne({ clientRequestId: campInput.clientRequestId })
      if (existing) return { camp: await toOrganizerCamp(existing), created: false }
    }

    // 2. Validate-first (read-only) — reject bad input before any write.
    const phones = participants.map((p) => canonicalizePhone(p.phone))
    const seen = new Set<string>()
    for (const phone of phones) {
      if (seen.has(phone)) throw new HttpError(409, `Duplicate participant phone: ${phone}`)
      seen.add(phone)
    }
    await Promise.all(
      [...seen].map(async (phone) => {
        if ((await membershipService.countParticipantCamps(phone)) >= 2) {
          throw new HttpError(409, `Phone ${phone} is already in 2 camps`)
        }
      }),
    )

    // 3. Write — reuse the services so all side-effects (creator membership,
    //    GroupPoints seed, phone canonicalization) are preserved.
    const created = await campService.create(campInput, creator)
    const campId = new Types.ObjectId(created.id)
    try {
      const refToId = new Map<string, string>()
      for (const g of groups) {
        const gd = await groupService.create(campId, { name: g.name, color: g.color })
        refToId.set(g.ref, gd.id)
      }
      for (const p of participants) {
        const groupId = p.groupRef ? (refToId.get(p.groupRef) ?? null) : null
        await rosterService.add(campId, p.phone, groupId)
      }
    } catch (err) {
      // 4. Compensating cleanup, then surface the original error.
      await campService.purge(campId)
      throw err
    }

    const camp = await CampModel.findById(campId)
    return { camp: await toOrganizerCamp(camp!), created: true }
  },
```

- [ ] **Step 4: Validate**

Run: `cd /Users/mn.afridi/Desktop/Camply/Backend && npm run validate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/mn.afridi/Desktop/Camply/Backend
npx prettier --write "src/services/camp.services.ts"
git add src/services/camp.services.ts
git commit -m "feat(camp): createFull — validate-first batch create with cleanup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Controller + OpenAPI summary

**Files:**
- Modify: `src/controllers/camp.controllers.ts`
- Modify: `src/docs/openapi.ts`

**Interfaces:**
- Consumes: `campService.createFull`.

- [ ] **Step 1: Route create through `createFull`**

In `src/controllers/camp.controllers.ts`, replace `createCamp`:

```ts
export const createCamp: RequestHandler = async (req, res) => {
  // createFull handles the plain (no groups/participants) case too; `created` is
  // false only on a clientRequestId dedupe hit, which returns 200 not 201.
  const { camp, created } = await campService.createFull(req.body, req.auth!.user)
  res.status(created ? 201 : 200).json(camp)
}
```

- [ ] **Step 2: Update the OpenAPI summary + responses**

In `src/docs/openapi.ts`, the `post` `/api/organizer/camps` registration — update the summary and add a 200:

```ts
  summary: 'Create a camp, optionally with groups + participants (batch)',
```
and in its `responses`, add alongside the existing `201`:

```ts
    200: {
      description: 'Existing camp (clientRequestId dedupe hit)',
      content: { 'application/json': { schema: OrganizerCampSchema } },
    },
```

- [ ] **Step 3: Validate**

Run: `cd /Users/mn.afridi/Desktop/Camply/Backend && npm run validate`
Expected: PASS.

- [ ] **Step 4: Runtime check (curl)**

Start the API and exercise the batch create. Requires an authenticated **organizer** session cookie (log in via the app or `POST /api/auth/login` with an organizer phone, saving the `camply_sid` cookie).

```bash
cd /Users/mn.afridi/Desktop/Camply/Backend && npm run dev   # :4000, connects to .env Atlas
```
Then, with a saved organizer cookie jar `cookies.txt`:
```bash
curl -s -b cookies.txt -X POST http://localhost:4000/api/organizer/camps \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"Batch Test","location":"Bo'\''stonliq",
    "startsAt":"2026-08-01T00:00:00.000Z","endsAt":"2026-08-10T00:00:00.000Z",
    "status":"published","clientRequestId":"test-uuid-001",
    "groups":[{"ref":"g1","name":"Foxes","color":"#e0982a"}],
    "participants":[{"phone":"901234567","groupRef":"g1"}]
  }' | jq .
```
Expected: `201`, a camp JSON with `groupCount:1`, `participantCount:1`, `status` reflecting dates. Re-running the **same** command returns the **same camp** (dedupe; HTTP 200). A bad `groupRef` returns `400`; a phone already in 2 camps returns `409` with nothing created (verify no stray camp via `GET /api/organizer/camps`).

(If no organizer cookie is available in this environment, the mechanical gate is `npm run validate`; note the curl check as owed.)

- [ ] **Step 5: Commit**

```bash
cd /Users/mn.afridi/Desktop/Camply/Backend
npx prettier --write "src/controllers/camp.controllers.ts" "src/docs/openapi.ts"
git add src/controllers/camp.controllers.ts src/docs/openapi.ts
git commit -m "feat(camp): route create through createFull (201 new / 200 dedupe)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Backend CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the batch endpoint**

In the "Organizer CRUD domains" section (near the camp/group/roster bullets), add a bullet:

```
- **Batch camp create.** `POST /organizer/camps` accepts an optional `groups[]` +
  `participants[]` (+ `status`, `clientRequestId`) alongside the camp fields;
  `campService.createFull` **dedupes** on `clientRequestId` (unique-sparse on `Camp`),
  **validates first** (canonical phones, no intra-payload dup phones, ≤2-camp limit,
  group-ref resolution) before any write, then **reuses** `create`/`groupService.create`/
  `rosterService.add` and **purges** (camp + groups + GroupPoints + memberships) on any
  post-write error. No transaction — portable to standalone/replica-set alike. The
  per-entity routes remain for incremental post-create edits. `campService.remove` now
  delegates its cascade to `campService.purge`.
```

- [ ] **Step 2: Validate + commit**

```bash
cd /Users/mn.afridi/Desktop/Camply/Backend
npm run validate
git add CLAUDE.md
git commit -m "docs(backend): document batch camp create (createFull/purge)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase B — Frontend

**Before starting Phase B:**
```bash
cd /Users/mn.afridi/Desktop/Camply/Frontend
git checkout dev && git pull && git checkout -b feat/batch-camp-create
```
(If the earlier wizard branch `fix/org-bugs` is not yet merged, branch off it instead so `useCampDraftStore` + `useCommitCampDraft` exist: `git checkout fix/org-bugs && git checkout -b feat/batch-camp-create`.)

## Task 7: `campsService.createFull` + types

**Files:**
- Modify: `src/api/services/camps.service.ts`

**Interfaces:**
- Produces: `CreateFullCampBody`; `campsService.createFull(body) → OrganizerCamp`.

- [ ] **Step 1: Add batch body types + method**

In `src/api/services/camps.service.ts`, after the `CreateCampBody` type add:

```ts
export type CreateCampGroupInput = { ref: string; name: string; color: string }
export type CreateCampParticipantInput = { phone: string; groupRef: string | null }

/** Batch create: camp + its groups + participants in one request. */
export type CreateFullCampBody = CreateCampBody & {
  status?: 'draft' | 'published'
  clientRequestId?: string
  groups?: CreateCampGroupInput[]
  participants?: CreateCampParticipantInput[]
}
```

Then inside `campsService`, after `create`, add:

```ts
  /** Creates a camp with its groups + participants in one POST (wizard commit). */
  createFull: async (body: CreateFullCampBody): Promise<OrganizerCamp> => {
    return (await axiosInstance.post<OrganizerCamp>('/organizer/camps', body)).data
  },
```

- [ ] **Step 2: Validate + commit**

```bash
cd /Users/mn.afridi/Desktop/Camply/Frontend
npm run validate
npx prettier --write --end-of-line auto src/api/services/camps.service.ts
git add src/api/services/camps.service.ts
git commit -m "feat(api): add campsService.createFull batch body + method

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Collapse the commit — store + hook

Store and hook change together: dropping `progress` from the store breaks the old
ledger-based hook, so both land in one compiling commit.

**Files:**
- Modify: `src/store/useCampDraftStore.ts`
- Modify: `src/api/queries/campDraft.queries.ts`

**Interfaces:**
- Produces: store gains persisted `clientRequestId: string`; loses `progress` + `setCampId`/`mapGroupId`/`markParticipantAdded`/`markPublished`. `useCommitCampDraft().mutateAsync()` → `Promise<string>` (unchanged signature).

- [ ] **Step 1: Simplify the store**

Replace `src/store/useCampDraftStore.ts` with:

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CAMP_GROUPS } from '../lib/groups'

/*
  The uncommitted camp-creation draft — CLIENT-OWNED form state (nothing hits the
  server until Finish), so it lives in Zustand, not React Query. `persist` →
  localStorage makes the whole wizard survive a refresh / PWA relaunch.

  `clientRequestId` is a stable idempotency key: the batch endpoint dedupes on it, so
  re-pressing Finish after a timeout returns the existing camp instead of duplicating.
  It's persisted (survives refresh) and regenerated on reset() for the next camp.
*/
export type DraftGroup = { tempId: string; name: string; color: string }
export type DraftParticipant = { tempId: string; phone: string; groupTempId: string }
export type CampDraftInfo = {
  name: string
  location: string
  starts: string // YYYY-MM-DD
  ends: string
  capacity: string
}

type CampDraftState = {
  clientRequestId: string
  info: CampDraftInfo
  groups: DraftGroup[]
  participants: DraftParticipant[]
  patchInfo: (patch: Partial<CampDraftInfo>) => void
  addGroup: (name: string) => void
  removeGroup: (tempId: string) => void
  addParticipant: (phone: string, groupTempId: string) => void
  removeParticipant: (tempId: string) => void
  reset: () => void
}

const EMPTY_INFO: CampDraftInfo = { name: '', location: '', starts: '', ends: '', capacity: '' }

export const useCampDraftStore = create<CampDraftState>()(
  persist(
    (set) => ({
      clientRequestId: crypto.randomUUID(),
      info: EMPTY_INFO,
      groups: [],
      participants: [],
      patchInfo: (patch) => set((s) => ({ info: { ...s.info, ...patch } })),
      addGroup: (name) =>
        set((s) => {
          const color = CAMP_GROUPS[s.groups.length % CAMP_GROUPS.length].color
          return { groups: [...s.groups, { tempId: crypto.randomUUID(), name, color }] }
        }),
      removeGroup: (tempId) =>
        set((s) => ({
          groups: s.groups.filter((g) => g.tempId !== tempId),
          participants: s.participants.filter((p) => p.groupTempId !== tempId),
        })),
      addParticipant: (phone, groupTempId) =>
        set((s) => ({
          participants: [...s.participants, { tempId: crypto.randomUUID(), phone, groupTempId }],
        })),
      removeParticipant: (tempId) =>
        set((s) => ({ participants: s.participants.filter((p) => p.tempId !== tempId) })),
      reset: () =>
        set({
          clientRequestId: crypto.randomUUID(),
          info: EMPTY_INFO,
          groups: [],
          participants: [],
        }),
    }),
    { name: 'camply-camp-draft' },
  ),
)
```

- [ ] **Step 2: Collapse the commit hook**

Replace `src/api/queries/campDraft.queries.ts` with:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { campsService } from '../services/camps.service'
import { organizerKeys } from '../queryKeys'
import { useCampDraftStore } from '../../store/useCampDraftStore'

/*
  Commits the in-memory camp draft on the wizard's Finish in ONE request. The backend
  (POST /organizer/camps) accepts the whole aggregate — camp + groups + participants —
  and owns consistency (validate-first + compensating cleanup) and idempotency (dedupe
  on clientRequestId), so the client no longer orchestrates or tracks a progress
  ledger. A retry re-sends the same payload; clientRequestId makes it safe.
*/
export function useCommitCampDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { info, groups, participants, clientRequestId } = useCampDraftStore.getState()
      const cap = info.capacity.trim() ? Number(info.capacity) : undefined
      const camp = await campsService.createFull({
        name: info.name.trim(),
        location: info.location.trim(),
        startsAt: new Date(info.starts).toISOString(),
        endsAt: new Date(info.ends).toISOString(),
        ...(cap !== undefined && Number.isFinite(cap) && cap > 0 ? { capacity: cap } : {}),
        status: 'published',
        clientRequestId,
        groups: groups.map((g) => ({ ref: g.tempId, name: g.name, color: g.color })),
        participants: participants.map((p) => ({ phone: p.phone, groupRef: p.groupTempId })),
      })
      return camp.id
    },
    onSuccess: (campId) => {
      queryClient.invalidateQueries({ queryKey: organizerKeys.camps })
      queryClient.invalidateQueries({ queryKey: organizerKeys.summary })
      queryClient.invalidateQueries({ queryKey: organizerKeys.camp(campId) })
      useCampDraftStore.getState().reset()
    },
  })
}
```

- [ ] **Step 3: Validate + build**

Run:
```bash
cd /Users/mn.afridi/Desktop/Camply/Frontend && npm run validate && npm run build
```
Expected: PASS both. (`CampWizard.tsx` and all steps still compile — they never referenced `progress`; only the hook did.)

- [ ] **Step 4: Runtime check (against the running backend)**

With the backend from Phase A running (`:4000`) and `npm run dev` on the frontend:
1. Org surface → New camp → fill Info (dropdown location), add groups + a participant.
2. **Network tab:** during steps 1–2 there are **zero** camp writes.
3. Press **Finish** → exactly **one** `POST /organizer/camps` with the nested body → land on the camp detail; `localStorage` `camply-camp-draft` cleared.
4. To confirm dedupe: trigger a failure (e.g. stop the backend), press Finish (error + retry shown), restart backend, press retry → the camp is created once (no duplicate on the camps list).

Expected: all of the above.

- [ ] **Step 5: Commit**

```bash
cd /Users/mn.afridi/Desktop/Camply/Frontend
npx prettier --write --end-of-line auto src/store/useCampDraftStore.ts src/api/queries/campDraft.queries.ts
git add src/store/useCampDraftStore.ts src/api/queries/campDraft.queries.ts
git commit -m "feat(camp-wizard): commit draft in one batch call; drop progress ledger

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Frontend CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the wizard note**

In the camp-wizard note added earlier (the "collect-then-commit" blockquote near the camps seam), replace the commit description so it reflects the single batch call:

```
> nothing hits the backend until **Finish**, when `useCommitCampDraft` sends the whole
> draft (camp + groups + participants) in **one** `POST /organizer/camps` (batch). The
> backend owns consistency + idempotency (dedupe on the store's persisted
> `clientRequestId`), so there's no client-side progress ledger — a retry just re-sends
> the same payload. The org-only Organizers step still invites org-global organizers
> immediately.
```

Also, in the "Client state — Zustand stores" section, adjust the `useCampDraftStore`
line to drop the "commit ledger" phrasing:

```
`useCampDraftStore` (the camp-creation wizard's uncommitted draft — info + groups +
participants + a stable `clientRequestId`; `persist`ed so the wizard survives refresh),
```

- [ ] **Step 2: Validate + commit**

```bash
cd /Users/mn.afridi/Desktop/Camply/Frontend
npm run validate
git add CLAUDE.md
git commit -m "docs(frontend): wizard commits via one batch call

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Extend `POST /organizer/camps` (backward-compatible) → Tasks 2, 5. ✅
- `clientRequestId` unique-sparse dedupe → Tasks 1 (model), 4 (dedupe branch), 8 (store id). ✅
- Validate-first (dup phones, ≤2 camps, group-ref) → Task 2 (Zod refine) + Task 4 (service pre-checks). ✅
- Reuse create/groupService/rosterService side-effects → Task 4. ✅
- Compensating cleanup + `purge` cascade fix → Tasks 3, 4. ✅
- `status:'published'` folds in publish → Task 3 (create honors status) + Task 8 (client sends it). ✅
- Frontend one-call collapse + drop ledger → Tasks 7, 8. ✅
- Docs both repos → Tasks 6, 9. ✅

**Type consistency:** `CreateFullInput`/`CreateInput` (backend) and `CreateFullCampBody` (frontend) agree on `status`/`clientRequestId`/`groups{ref,name,color}`/`participants{phone,groupRef}`. `createFull → { camp, created }` consumed by the controller. `refToId` maps `ref→id` (group projection `.id`). Store `clientRequestId` produced in Task 8, consumed by the hook same task. ✅

**Placeholder scan:** every code step is complete; no TBD/TODO. ✅

**Ordering note:** Phase A must land (and be running) before Phase B's runtime check; Phase B compiles independently. The `ZodEffects` split (Task 2) is the one non-obvious gotcha — `updateCampSchema` derives from `campCoreSchema`, never the refined schema.
