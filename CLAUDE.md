# CLAUDE.md — camply-backend

The Express API for Camply. Product context (roles, guardrails) lives in the
monorepo root: `../CLAUDE.md` and `../CONTEXT.md`. **Read those guardrails before
touching auth or permissions.** This file covers the backend stack and conventions.

## Commands

- `npm run dev` — nodemon dev server on **:4000** (`MONGO_URI` must point at a
  running MongoDB).
- `npm run build` — `tsc` → `dist/`. `npm start` runs the build.
- `npm run typecheck` — `tsc --noEmit`, the primary per-change gate.
- `npm run lint` — **oxlint** (not ESLint). `npm run format` / `format:check` — Prettier.
- `npm run validate` — lint + format:check + typecheck (the pre-commit hook).
- `npm run seed:demo` — dev-only: **wipes all camp data** (camps, groups,
  memberships, activities, announcements, leaderboards — user accounts are kept)
  and rebuilds one published camp with 1 manager, 10 organizers, 100 participants
  in 10 groups. Everyone gets a real `User` (not a bare membership row): the roster
  and team projections read names off the **bound** user, and `userId: null` reads
  as a *pending invite*. Uses reserved phone ranges (`+99894000…`) so re-runs are
  idempotent without touching hand-made accounts.
- `npm run seed:org` — dev-only: provisions the first `organization` from
  `SEED_ORG_USERNAME` / `SEED_ORG_PASSWORD` (dev defaults `admin` / `1234`). The
  org is keyed by **username** and has no phone.

No test runner is configured (project preference) — verify manually with curl or
`/api/docs`.

## Stack

Express 5 · Mongoose 9 (MongoDB) · Zod 4 · TypeScript (strict, CommonJS).
`@asteasolutions/zod-to-openapi` generates Swagger at `/api/docs`.

## Conventions (follow these exactly)

- **Layering:** `routes → controllers → services → models`. Controllers are
  **thin** (no try/catch — Express 5 forwards async throws to the error
  middleware). All business/data logic lives in **services**. Throw
  `new HttpError(status, message)` from anywhere.
- **Validation:** every input gets a Zod schema in `validators/`, applied via the
  `validate({ body, params, query })` middleware. **Import `z` from
  `config/zod`** (never `'zod'`) so `.openapi()` metadata attaches.
- **Env:** all config goes through `config/env.ts` (Zod-validated at boot). Never
  read `process.env` directly elsewhere.
- **Docs:** add a `registry.registerPath(...)` in `docs/openapi.ts` for every new
  endpoint, reusing validator schemas so docs can't drift.

## Authentication & authorization (the worked example)

- **Cookie sessions, server-side.** Login/register set an httpOnly cookie
  `camply_sid` holding an opaque random token; the real session lives in the
  `sessions` collection (`models/session.model.ts`) with a TTL index. Only the
  **sha256** of the token is stored — never the raw value.
- **Two middlewares, composed on every protected route** (`middlewares/auth.middleware.ts`):
  `requireAuth` (loads the session + user into `req.auth`) then `requireRole(min)`
  (rank check: **participant(1) < organizer(2) < manager(3) < organization(4)**).
  Example: `router.post('/managers', requireAuth, requireRole('organization'), ...)`.
- **Role guardrail:** `POST /auth/register` **always** creates a `participant` —
  the client-sent `role` is ignored. Organizations exist only via `npm run seed:org`;
  **managers only via the org-only `POST /managers`** (a manager can't mint a peer
  manager — the route is `requireRole('organization')`); **organizers via the
  manager-or-above `POST /organizers`** (org + managers invite organizers). A hidden
  button is never a permission — the server is the sole authority.
- **Managers own camps.** `POST /organizer/camps` carries a route-specific
  `requireRole('manager')` (the router itself stays `requireRole('organizer')` so
  organizers keep read/operate access). `campService.createFull` enforces **one camp
  per manager** (`role === 'manager'` + `createdBy` count → **409**, after the
  `clientRequestId` dedupe); the org is exempt. Organizers can't create camps.
  `campScope.requireCampManager` treats the **manager account role** and a `manager`
  membership as manager-tier alongside organizer-tier memberships/org/creator, so
  organizers still get full camp-ops writes (captured, not gated).
- **Managers/organizers share one onboarding engine.** Both invite domains
  (`services/organizer.services.ts`, `services/managers.services.ts`) are thin
  instances of `makeOnboardingService(...)` in **`services/onboarding.factory.ts`**
  (invite token + email + status derivation + deactivation; differ only in the
  account `role` stamped/queried and which memberships purge on delete). The
  `/managers` domain (routes/controllers/validators) mirrors `/organizers` and is
  **org-only**. Register both in `docs/openapi.ts`.
- **Login identity:** participants/organizers log in by **phone**; the organization
  logs in by **username** (`User.username`, sparse-unique, lowercased — the org has
  no phone, which is now optional on the model). `loginSchema` is a union of the two
  shapes; `authService.login` branches on which is present.
- **`active` flag + deactivation:** every user has `User.active` (default true).
  Both `authService.login` and `requireAuth` reject `active === false` (401), so a
  deactivated organizer can't sign in **or** ride an existing session. Deactivating
  also calls `sessionService.revokeAllForUser` to kill live sessions immediately.
- **`organizers` domain** (`routes/services/controllers/validators/organizer.*`),
  org-only, extracted out of `auth.*`. Organizers are now onboarded by **emailed
  magic link**, not created fully-formed: `POST /organizers` takes `{name, surname,
email, phone}`, records the (canonicalized, unique-checked) phone, creates a
  **pending** organizer (no password), issues an `Invite` token, and emails a link
  (returns `inviteUrl` in dev). `POST
/organizers/:id/resend` re-issues the token; `DELETE /organizers/:id` revokes a
  pending invite (deletes the stub user). `PATCH /organizers/:id` (`{ active }`)
  deactivates/reactivates an _accepted_ organizer. Status is **derived** in
  `toPublicOrganizer` (`acceptedAt == null` → `pending`, else `active`/`deactivated`
  by the `active` flag), not stored — `acceptedAt` replaced the old "no phone yet ⇒
  pending" heuristic now that the phone is set at invite time. The old
  password-based `create` is gone (organizers log in by phone). **Guard:** a
  pending (not-yet-accepted) organizer **or manager** **cannot** log in by phone —
  `authService.login` rejects `(role === 'organizer' || role === 'manager') &&
  !acceptedAt`, so the pre-set phone alone never bypasses the email accept.
- **Invite onboarding** (`models/invite.model.ts`, `services/invite.services.ts`,
  `services/mailer.service.ts`, public `routes/invite.routes.ts`). The `Invite` model
  mirrors `session.model.ts` (sha256 of the token, TTL index, single-use). Public,
  token-gated (no `requireAuth`): `GET /invite/:token` → `{name, email}` for the
  accept screen; `POST /invite/:token/accept` (no body — the phone was recorded at
  invite time) sets `acceptedAt`, activates the user, deletes the invite, and
  **starts a session** (sets `camply_sid`) — same shape as login. Mailer uses nodemailer: real SMTP if `SMTP_*` env is set, else a dev
  **Ethereal** test account (preview URL logged, no real delivery). The invite
  email **markup** lives in `src/emails/organizerInvite.ts` (a pure
  `renderOrganizerInvite({name, link}) → {subject, html, text, attachments}`;
  `mailer.service` only sends). It's a branded, table-layout HTML template (Uzbek
  only for now — trilingual is a tracked follow-up). The header banner
  (`src/emails/assets/camply-header.png`) is embedded as a **CID inline
  attachment** (`cid:camply-header`), so it ships inside every email and needs no
  public URL/hosting — the `build` script copies the asset into `dist/`. Preview
  it with `npx tsx src/scripts/previewInviteEmail.ts`. `User` gained a
  sparse-unique `email` field.
- **Participants authenticate by phone alone** (no secret yet). The `/login` and
  `/register` handlers are shaped so an OTP verification step drops in later
  without changing `/me`, sessions, or authorization.
- **Claim-on-login + profile contract** (organizer onboarding chain). In the phone
  branch, `authService.login` now **claims a pre-provisioned participant**: an
  unknown phone that has a **pending participant `Membership`** (`userId: null`)
  provisions a nameless participant `User` (then `bindPhone` + session) instead of
  401-ing; an unknown phone with **no** pending membership still 401s (the allowlist
  guardrail holds). `User.name`/`surname` are now **optional** (a claimed participant
  is nameless until they finish). `completeProfile` (`PATCH /auth/me`) grew
  `name`/`surname` (required) + optional organizer **`subRole`** (one of
  `ORGANIZER_SUB_ROLES`, applied only when `role === 'organizer'` — stored, not
  enforced); `profileComplete` now also requires `name`. Both participant
  (self-named) and organizer (onboarding) use this one endpoint. Design/plan:
  `docs/superpowers/{specs,plans}/2026-07-12-organizer-onboarding-chain*.md`. Org/organizer accounts use a
  `bcryptjs` password (`passwordHash`, `select:false`, never returned).
- **Sessions:** sliding expiry (`sessionService.refreshIfStale`), instant
  revocation (`/logout`), and "log out everywhere" (`/logout-all`).

Design + plan: `docs/superpowers/specs/2026-07-11-auth-authorization-design.md`,
`docs/superpowers/plans/2026-07-11-auth-authorization.md`.

## Participant camp resolution (`/me/camps`, `/camps/:id/my-group`)

How a logged-in participant finds their camp. Before this, the client sent a
literal `'current'` as the campId, which the 24-hex `campIdParam` rejected — every
participant camp request 400'd.

- **`GET /me/camps`** (`routes/me.routes.ts`, `requireAuth` only — self-scoped, no
  role gate). `campService.listForParticipant` queries memberships by **`userId`,
  not phone**: `requireCampMember` resolves with `{campId, userId}`, so a phone
  match could list a camp whose unbound row then 403s on every call. Excludes
  **draft** (not ready) and **archived** (finished ⇒ "no camp", not stale content).
  Ordered by **relevance** — active, then soonest upcoming — because the client
  opens `camps[0]`, and a plain `startsAt` sort puts the *oldest* camp first.
- **`toParticipantCamp`** is deliberately **not** `toOrganizerCamp`: that one
  spreads `...campCounts`, leaking `participantCount`/`groupCount` to participants.
- **`GET /camps/:id/my-group`** (on the shared `campRouter`, member-level). Uses
  `toMyGroup`, **not** `toCampGroupDetail` — the latter returns full names and
  falls back to `m.phone` as a display name, which is correct for the organizer's
  roster and a privacy leak in a card the whole group sees. Returns initials + a
  color only. `{ group: null }` with **200** when unassigned (a valid state).
- **Color conventions differ on purpose:** `members[].color` is a palette *token*
  (client resolves to `var(--color-*)` so dark mode works); `group.color` is
  whatever the organizer picked, which in existing data is raw **hex** despite
  `group.model.ts` calling it a token.

Design + plan: `docs/superpowers/{specs,plans}/2026-07-18-participant-live-camp-data*.md`.

## Organizer CRUD domains (camp, group, roster, schedule, announcement, leaderboard, team)

The organizer view's data layer. Seven domains behind the standard
`routes → controllers → services → models` layering, each shipping a `toPublic*`
projection that reproduces the frontend contract exactly (the frontend services flip
mock → live with no UI change).

- **Models** (`models/`): `camp`, `group`, `membership`, `activity`, `announcement`,
  `leaderboard` (`GroupPoints` + append-only `PointEvent`). `Camp.status` stores only
  `draft`/`published` — the public `upcoming`/`active`/`archived` is **derived from
  dates** in `toOrganizerCamp`, never stored.
- **Batch camp create.** `POST /organizer/camps` accepts an optional `groups[]` +
  `participants[]` (+ `status`, `clientRequestId`) alongside the camp fields;
  `campService.createFull` **dedupes** on `clientRequestId` (unique-sparse on `Camp`),
  **validates first** (canonical phones, no intra-payload dup phones, ≤2-camp limit,
  group-ref resolution) before any write, then **reuses** `create` /
  `groupService.create` / `rosterService.add` and **purges** (camp + groups +
  GroupPoints + memberships) on any post-write error. No transaction — portable to
  standalone/replica-set alike. Per-entity routes remain for incremental post-create
  edits. `campService.remove` now delegates its cascade to `campService.purge`.
  Dedupe hit returns **200** (existing camp); a fresh create returns **201**.
  **One camp per manager:** `createFull` rejects a second create from a
  `role === 'manager'` caller who already has a camp (`createdBy` count, **409**) —
  checked _after_ the dedupe so an idempotent retry of their first camp still returns
  it. The **organization** super-admin is exempt (unlimited camps); organizers can't
  create camps at all (route-level `requireRole('manager')`). The frontend also hides
  the create button, but the server is the authority.
- **Membership is the join foundation.** Keyed by `{campId, phone}` (unique). The
  organizer pre-provisions a participant by **phone** (`status: 'pending'`, no
  `userId`); on **login** `membershipService.bindPhone` attaches the row to the user
  and flips it `active` (additive + idempotent — the one touch-point in `auth.services`;
  `/login`/`/me` shapes unchanged). The 6 **organizer sub-roles**
  (`ORGANIZER_SUB_ROLES` — `projectManager` was promoted to the `manager` account
  role) all grant camp-management; `MEMBERSHIP_ROLES` also carries `manager` (the
  camp creator's own row). Granular per-sub-role enforcement is post-launch
  (captured, not gated). ≤2 participant camps
  per phone is enforced at roster add. **`rosterService.add` canonicalizes the phone**
  (`+998…`, same as login) before storing/counting — otherwise the pending membership
  would never match the canonical phone `authService.login`/`bindPhone` query with, and
  the claim-on-login chain would silently 401. A repeat add for the same `{campId,
phone}` maps the Mongo `E11000` to a clean **409**, not a 500.
- **Camp-scoping middleware** (`middlewares/campScope.middleware.ts`), composed
  **after** `requireAuth`: `requireCampMember` (resolves `:id` → `req.camp` +
  `req.membership`; org super-admin sees any camp in its org; **reads** use this) and
  `requireCampManager` (organizer-tier membership / org / camp creator; **writes** use
  this). Sub-routers under `/camps/:id/...` and `/organizer/camps/:id/...` **must** use
  `Router({ mergeParams: true })` or the middleware can't read `:id`. `req.camp` /
  `req.membership` are augmented in `types/express.d.ts`.
- **Routes:** `/organizer/camps` + `/organizer/summary` (organizer management,
  organizer-only) and `/camps/:id/...` (shared read — participants included). Roster
  and groups mount under the organizer camp router (manager-gated); schedule,
  announcements, and leaderboard mount under the shared `campRouter` (member-read,
  manager-write). **Team** (`/organizer/team`, cross-camp) is backed by organizer-tier
  `Membership` rows (`active` = member, `pending` = invite) — the invite sub-role
  guardrail lives in `team.validators` (a `z.enum` of the 7 sub-roles, so a body
  granting a peer `organizer`/`organization` fails validation). _Known limitation:_ a
  team invite attaches to the caller's newest camp (Membership is camp-keyed); a true
  cross-camp team model is a follow-up (see the `TODO(multi-camp)` in
  `team.services`).

Design + plan: `docs/superpowers/specs/2026-07-12-organizer-crud-endpoints-design.md`,
`docs/superpowers/plans/2026-07-12-organizer-crud-endpoints.md`.

## Realtime chat (`Message` model, `/camps/:id/chat`, `sockets/`)

Persistent, live chat over **Socket.IO**. REST is history-load only; sending +
receiving happen on the socket.

- **`Message` model** (`models/message.model.ts`): `{ campId, channel:'group'|'organizers',
  groupId, authorId, text }`. `groupId` is non-null iff `channel==='group'`. Text-only
  (1–2000, trimmed) — no `kind`/attachments/reactions server-side. Index
  `{campId, channel, groupId, createdAt}` (the "latest N for this room" shape).
- **`chatService`** (`services/chat.services.ts`) is the single source of truth for
  both REST + socket: `history` (latest 50, oldest→newest), `groupMembers`/
  `organizerMembers` (bound-user projections, same `initialsOf`/`colorFor` pattern),
  `postMessage`. Messages carry only `authorId`; the client resolves the author
  against the `members[]` the history/bootstrap supplies.
  **Member projection is batched (2026-07-27):** `membersFrom` does ONE
  `UserModel.find({_id:{$in:…}}).select(…).lean()` plus a Map — it used to run
  `findById` inside a `for` loop. Because the DB is remote (`mongodb+srv`), that
  loop cost one ~180ms network round-trip **per member**, not one cheap lookup:
  the organizers history measured **2.15s → 0.90s** on the demo seed. All three
  chat reads are `.lean()` (everything is projected to a DTO immediately, so
  `toChatMessage` takes a `MessageLike` that accepts a lean object OR a hydrated
  document — `postMessage` still passes the latter), and both `list*History`
  assemblers wrap their three independent queries in `Promise.all` instead of
  letting the object literal serialize them. Response contract unchanged.
  **Rule: never `await` a per-row query inside a loop — batch with `$in`.**
  Design/plan: `docs/superpowers/{specs,plans}/2026-07-27-chat-load-performance*.md`.
- **REST** on the shared `campRouter`: `GET /camps/:id/chat/group/messages`
  (member-level; `groupId` from `req.membership`, **never** the URL — unassigned →
  `200 {groupId:null, members:[], messages:[]}`) and
  `GET /camps/:id/chat/organizers/messages` (`requireCampManager` — participant 403s).
- **`GET /camps/:id/my-role`** (member-level) → `{role, groupId}` for the caller's own
  membership — the server-known fact the frontend gates coordinator chat on (replaces
  an unpersisted client value).
- **Sockets** (`sockets/`): attached to the raw `http.Server` in `server.ts` (not the
  Express app). Handshake auth (`sockets/auth.ts`) parses the `camply_sid` cookie and
  runs the **identical** live-session + `active` check `requireAuth` does — rejects the
  handshake, so a deactivated account can't hold a socket. **Rooms are server-derived**
  (`sockets/chat.handlers.ts`), never client-named: `chat:connectCamp` loads the
  caller's membership and joins `group:{campId}:{groupId}` (participants **and** that
  group's coordinator — the same shared room) and/or `organizers:{campId}`
  (organizer-tier + org). `chat:send` re-derives `groupId` server-side (a client-sent
  one is ignored), authorizes, persists via `chatService`, broadcasts `chat:message`;
  failures return a `chat:error` ack. `chat:presence` is in-memory per-room (single
  process — resets on restart, acceptable at current scale).
- **Coordinator group home:** reuses `Membership.groupId` on `role==='coordinator'`
  rows. Set at invite (`POST /organizer/team/invites` optional `groupId`, coordinator-only,
  resolved against the caller's own camp) or after the fact
  (`PATCH /organizer/team/:membershipId/group`, `requireRole('manager')`).

Design + plan: `docs/superpowers/{specs,plans}/2026-07-21-realtime-chat-design.md`,
`docs/superpowers/plans/2026-07-22-realtime-chat.md`.

### Chat liveness — reactions, read receipts, unread (2026-07-23)

Extends the above; same Socket.IO transport + `chatService`.

- **Reactions are server-persisted.** `Message.reactions: [{ userId, emoji }]`
  (embedded, bounded). `chatService.toChatMessage(doc, viewerId?)` aggregates to
  `{ emoji, count, mine }[]` (mine per viewer). `chatService.toggleReaction(...)`
  toggles one pair and returns `{ emoji, count }[]`. Socket `chat:react { campId,
  channel, messageId, emoji }` (emoji allowlisted in `chat.validators`) re-derives
  entitlement like `chat:send`, toggles, and broadcasts `chat:reaction { messageId,
  reactions: {emoji,count}[] }` — **counts only, no reactor identities on the wire**
  (clients own their `mine`).
- **Read receipts = "seen by anyone."** `ChatRead { campId, channel, groupId|null,
  userId, lastReadAt }` (unique per room+user). `chatRead.services`: `mark`,
  `othersLastReadAt` (max over OTHER members — seeds the ✓✓), `unreadCounts`. Socket
  `chat:read { campId, channel }` upserts + broadcasts `chat:read { userId,
  lastReadAt }`. REST history payloads now carry `othersLastReadAt`. A message is
  read when any other member's `lastReadAt ≥ its createdAt`.
- **Unread seed:** `chat:connectCamp` emits `chat:unread { rooms: [{channel, groupId,
  count}] }` to the joining socket (messages after my `lastReadAt`).

## Push notifications (`/push/subscribe`, `notify.service`, `sockets` dispatch)

Implements the frozen push contract from the never-built `2026-07-20-realtime-delivery`
batch — but on the shipped Socket.IO transport, for the chat slice.

- **Model:** `PushSubscription { userId, endpoint (unique), keys{p256dh,auth},
  userAgent }`. **Routes:** `POST /push/subscribe { subscription }` (idempotent
  upsert on `endpoint`) + `DELETE /push/subscribe { endpoint }`, both `requireAuth`.
- **`services/push/sender.ts`** wraps `web-push`; no-ops with a warning if VAPID env
  is unset; prunes a subscription on `410`/`404`. **Env (all optional):**
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Generate with
  **`npm run vapid:gen`** (public key → frontend `VITE_VAPID_PUBLIC_KEY`).
- **`services/notify.service.ts`** is the single push fan-out. `notify.chatMessage`
  pushes to room members **minus the author minus everyone currently in that room's
  socket** (`fetchSockets()` presence). Called from `chat.handlers` after each
  `chat:message` broadcast. Copy is rendered per recipient's `User.language` from the
  small server map **`src/i18n/notifications.ts`** (not the frontend translations).
- **`User.language`** (`'uz'|'ru'|'en'`, default `'uz'`) synced via
  **`PATCH /auth/me/language`**; exposed on `toPublicUser`. Announcement/schedule/
  leaderboard push remain a follow-up that plugs into the same `notify.service`.

Design + plan: `docs/superpowers/{specs,plans}/2026-07-23-chat-reactions-receipts-push*.md`.

## Deploy caveat — cross-origin cookies

In dev the frontend reaches the API through Vite's `/api` proxy, so the cookie is
**same-origin** and `SameSite=Lax` works. If prod serves the API on a **different
origin** than the app, the session cookie needs `SameSite=None; Secure` and CORS
`credentials: true` with an explicit `origin` — update `config/cookies.ts` and the
`cors(...)` options together.

## Known gotcha — stale Mongo indexes

Mongoose does **not** drop indexes you stop declaring, nor **alter** an index whose
options changed. If you remove a `unique` field — or add `sparse` to an existing
unique index — the old index lingers in any DB that already ran the previous schema
and can cause spurious `E11000 duplicate key` errors. Drop it manually in that DB:
`db.collection.dropIndex('field_1')` (then let Mongoose rebuild it, or recreate it
with the right options). (A fresh DB is never affected.)

> **Hit in practice (2026-07-12):** `phone_1` existed as `unique` but **not
> `sparse`** in the dev DB (built before `phone` became optional). Creating a
> phone-less _pending_ organizer collided with the org's `null` phone
> (`E11000 … phone: null`). Fix was `db.users.dropIndex('phone_1')` +
> `createIndex({phone:1},{unique:true,sparse:true})`. The schema was already correct.

## Keep this file current

Update it in the same change whenever you alter architecture, conventions,
commands, or a cross-cutting pattern (a new middleware, a new layer rule).
