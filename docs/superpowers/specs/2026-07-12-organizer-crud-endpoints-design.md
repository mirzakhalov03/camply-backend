# Organizer CRUD & Endpoints — Design

**Date:** 2026-07-12
**Scope:** Backend. Foundation (Camp + Membership) + all non-realtime CRUD for the
organizer view — domains 1–7. Excludes group chat, SOS, and live map (realtime,
separate designs).

---

## 1. Goal

The organizer view frontend is fully built but runs entirely on mock data. Every
service in `Frontend/src/api/services/*` (and `lib/leaderboard.ts`) has the real
axios call written and commented out — a data contract the backend has not yet
filled. The backend today has only three domains: `auth`, `invite`, `organizer`.

This design specifies the models, endpoints, permissions, and response projections
that make the organizer view real, and the seam by which each frontend service
flips from mock → real with no UI change.

**Success:** an organizer can create a camp, create groups, add participants by
phone, author schedule + announcements, and adjust the leaderboard — all persisted,
all authorized server-side — and each frontend service points at a live endpoint.

---

## 2. Current state (what exists)

- **Auth foundation** (`auth`, `invite`, `organizer` domains): cookie sessions,
  `requireAuth` + `requireRole(min)` middleware, phone-based participant login,
  username-based org login, email magic-link organizer onboarding. See
  `2026-07-11-auth-authorization-design.md`.
- **Models:** `user`, `session`, `invite` only.
- **Frontend contracts** (the spec the backend fills), from the commented axios
  lines:
  - `camps.service.ts` — `OrganizerCamp`, `OrganizerSummary`
  - `roster.service.ts` — `RosterParticipant`
  - `campGroups.service.ts` — `CampGroupDetail`, `GroupMember`
  - `schedule.service.ts` — `Activity`, `NewActivity`, `ActivityScope`
  - `announcements.service.ts` — `Announcement`, `NewAnnouncement`, `AnnouncementScope`
  - `lib/leaderboard.ts` — `Leaderboard`, `LeaderboardGroup`, `LeaderboardBreakdown`
  - `team.service.ts` — `Team`, `TeamMember`, `PendingInvite`

The backend must honor these URLs and response shapes exactly.

---

## 3. The membership / join foundation

**Phone is the join key.** The participant already authenticates by phone alone
(no self-serve invite code). Camp membership is provisioned by the organizer
*before* the participant's account may exist, and binds on signup.

**Flow:**
1. Organizer creates a camp.
2. Organizer creates groups within it.
3. Organizer adds participants **by phone**, assigning each to a group. This writes
   a `Membership { campId, phone, groupId, status: 'pending' }` — no `User` row
   required yet.
4. When that phone registers/logs in, `authService` looks up pending memberships
   for the phone, sets `userId`, and flips `status: 'active'`. The participant lands
   inside their camp + group immediately.

**≤2 camps** is enforced at membership creation: a phone may hold at most two
`participant` memberships (`status` in `pending`/`active`).

> **Divergence from CONTEXT.md.** CONTEXT §1/§3 describe a 6-digit invite-code join.
> This design **supersedes** that with phone-based pre-provisioning, per product
> decision (2026-07-12). No code path is built. If a self-join code is later wanted,
> it is additive (a `Camp.joinCode` + `POST /camps/join`), not a rework.

---

## 4. Data model

Six new Mongoose models. Follow existing conventions (`InferSchemaType`, exported
role/enum constants, `timestamps: true`).

### `Camp`
```
{ name, location, startsAt: Date, endsAt: Date, capacity: Number,
  languages: [String],            // subset of ['en','uz','ru']
  coverImage: String | null,
  status: 'draft' | 'published',  // STORED. draft = unpublished.
  createdBy: ObjectId<User>,
  organizationId: ObjectId<User>, // the org this camp belongs to
  timestamps }
```
- **Public `status` is derived** for published camps: `upcoming` (now < startsAt),
  `active` (startsAt ≤ now ≤ endsAt), `archived` (now > endsAt, or manually
  archived). `draft` is the only stored non-live state. An `archivedAt` timestamp
  supports manual archive of a still-dated camp.
- `dateRange`, `dayCurrent`, `dayTotal`, `participantCount`, `groupCount`,
  `organizerCount`, `checkinPct` are **computed in the projection**, never stored.

### `Group`
```
{ campId: ObjectId<Camp>, name, color: String,   // palette token e.g. 'pine'
  leaderMembershipId: ObjectId<Membership> | null,
  photo: String | null, timestamps }
```

### `Membership` — the foundation
```
{ campId: ObjectId<Camp>,
  phone: String,                    // E.164 — the join key, always present
  userId: ObjectId<User> | null,    // bound on signup
  groupId: ObjectId<Group> | null,
  role: 'participant' | OrganizerSubRole,
  checkin: 'in' | 'out',            // default 'out'
  status: 'pending' | 'active',     // active once userId is bound
  timestamps }
```
- Compound index `{ campId, phone }` unique — one membership per phone per camp.
- Index `{ phone, role }` for the ≤2-camps check and signup binding.
- Roster of a camp = memberships where `role === 'participant'`.
- **`OrganizerSubRole`** = the 7 canonical keys from the frontend's
  `components/organizer/roles.ts`: `projectManager`, `coordinator`, `admin`,
  `media`, `brandFace`, `eventManager`, `photographer`. Any of these is
  "organizer-tier" and grants camp management. Exported as a shared const on the
  model (mirror `USER_ROLES`).
- **Sub-roles live here, not on `User.role`.** Global role stays `organizer`;
  granular *permission enforcement* per sub-role is post-launch (CONTEXT §7). For
  now every organizer-tier membership gets full manager access — the field is
  captured, the gating deferred.

### `Activity`
```
{ campId, title, location, startsAt: Date, endsAt: Date,
  scope: 'camp' | 'group', groupId: ObjectId<Group> | null,
  description: String | null, timestamps }
```
- Status (`done`/`now`/`upcoming`) is **derived on the client** from the window
  (`activityStatus()` already exists) — never stored, never returned.

### `Announcement`
```
{ campId, title: String | null, body, scope: 'camp' | 'group',
  groupId: ObjectId<Group> | null, authorId: ObjectId<User>,
  pinned: Boolean (default false), timestamps }
```
- List order: pinned-first, then `createdAt` desc.

### `GroupPoints` (leaderboard) + `PointEvent`
```
GroupPoints { campId, groupId, activities: Number, attendance: Number,
              challenges: Number, previousScore: Number, timestamps }
PointEvent  { campId, groupId, category, delta: Number,
              byUserId: ObjectId<User>, createdAt }
```
- `score` = `activities + attendance + challenges` (computed).
- `previousScore` is snapshotted per ranking period → drives the trend arrow.
- `PointEvent` is an append-only audit log; also the natural source for the
  realtime nudge later. Adjusting points writes an event **and** updates the running
  category total in one service call.

---

## 5. Endpoint inventory

Namespaces preserved from the frontend contracts: `/organizer/*` (management
projection) and `/camps/*` (shared resource participants also read). `[F]` = the
frontend already calls it; `[+]` = new CRUD the organizer view will grow into.

### Camps
| M | Path | Guard | |
|---|---|---|---|
| GET | `/organizer/camps` | organizer | `[F]` list, active/newest first |
| GET | `/organizer/summary` | organizer | `[F]` cross-camp totals |
| GET | `/organizer/camps/:id` | campManager | `[F]` management projection |
| POST | `/organizer/camps` | organizer | `[+]` create (status `draft`) |
| PATCH | `/organizer/camps/:id` | campManager | `[+]` edit |
| POST | `/organizer/camps/:id/publish` | campManager | `[+]` draft → published |
| POST | `/organizer/camps/:id/archive` | campManager | `[+]` manual archive |
| DELETE | `/organizer/camps/:id` | campManager | `[+]` only while `draft` |
| GET | `/camps/:id` | campMember | participant read projection |

### Groups
| M | Path | Guard | |
|---|---|---|---|
| GET | `/organizer/camps/:id/groups` | campManager | `[F]` groups + members + leader |
| POST | `/organizer/camps/:id/groups` | campManager | `[+]` create `{name,color}` |
| PATCH | `/organizer/camps/:id/groups/:gid` | campManager | `[+]` rename/recolor/set leader |
| DELETE | `/organizer/camps/:id/groups/:gid` | campManager | `[+]` unassigns members |

### Roster / Participants
| M | Path | Guard | |
|---|---|---|---|
| GET | `/organizer/camps/:id/roster` | campManager | `[F]` pending + active rows |
| POST | `/organizer/camps/:id/roster` | campManager | `[+]` add by phone `{phone, groupId?}` (≤2 enforced) |
| PATCH | `/organizer/camps/:id/roster/:mid` | campManager | `[+]` reassign group / set role |
| PATCH | `/organizer/camps/:id/roster/:mid/checkin` | campManager | `[+]` toggle in/out |
| DELETE | `/organizer/camps/:id/roster/:mid` | campManager | `[+]` remove |

### Schedule
| M | Path | Guard | |
|---|---|---|---|
| GET | `/camps/:id/schedule` | campMember | `[F]` all activities |
| POST | `/camps/:id/schedule` | campManager | `[F]` create |
| PATCH | `/camps/:id/schedule/:aid` | campManager | `[+]` edit |
| DELETE | `/camps/:id/schedule/:aid` | campManager | `[+]` delete |

### Announcements
| M | Path | Guard | |
|---|---|---|---|
| GET | `/camps/:id/announcements` | campMember | `[F]` pinned-first |
| GET | `/camps/:id/announcements/:aid` | campMember | `[F]` one |
| POST | `/camps/:id/announcements` | campManager | `[F]` post |
| PATCH | `/camps/:id/announcements/:aid` | campManager | `[+]` edit |
| PATCH | `/camps/:id/announcements/:aid/pin` | campManager | `[+]` pin/unpin `{pinned}` |
| DELETE | `/camps/:id/announcements/:aid` | campManager | `[+]` delete |

### Leaderboard
| M | Path | Guard | |
|---|---|---|---|
| GET | `/camps/:id/leaderboard` | campMember | `[F]` standings + categories |
| POST | `/camps/:id/leaderboard/:gid/points` | campManager | `[F]` adjust `{delta, category}` |

### Team (organizer sub-roles)
| M | Path | Guard | |
|---|---|---|---|
| GET | `/organizer/team` | organizer | `[F]` members + pending |
| POST | `/organizer/team/invites` | organizer | `[F]` invite by phone + sub-role |
| DELETE | `/organizer/team/invites/:id` | organizer | `[F]` cancel |

> **Team reuses the existing `Invite` model** — org→organizer magic-link exists;
> organizer→coordinator is the same mechanism one tier down. Guardrail: an organizer
> **cannot** mint a peer `organizer` global role — invites grant sub-roles only.

---

## 6. Permissions & camp-scoping middleware

Two new middlewares, mirroring `requireAuth`/`requireRole`, composed **after**
`requireAuth`. Live in `middlewares/campScope.middleware.ts`.

- **`requireCampMember`** — resolves the caller's relationship to `:id` (camp):
  - `organization` role → access to any camp where `camp.organizationId` matches.
  - otherwise load `Membership { campId, userId }`; none → `403`.
  - attaches `req.camp` and `req.membership`. **Reads** use this (participants
    included).
- **`requireCampManager`** — passes when `req.membership.role` is organizer-tier,
  or the caller is `organization` / `camp.createdBy`. **Writes** use this.

**Camp creation seeds the creator's own organizer membership** (`role:
'projectManager'` — the lead sub-role, `status: 'active'`, `userId` = creator)
alongside `createdBy`. So one membership lookup governs everything — no special-case
for "the person who made it."

`GET /organizer/camps` and `/organizer/summary` are not camp-scoped: they list/
aggregate over the caller's organizer memberships (`{ userId, role: organizer-tier }`)
— or all org camps for an `organization` caller.

---

## 7. Response projections (the mappers)

Denormalized/derived fields are computed in `toPublic*` service functions, never
stored. Each must reproduce the frontend contract exactly.

- **`toOrganizerCamp(camp)`** → `OrganizerCamp`: derive `status`, `dateRange`
  ("Jul 6 – Jul 19"), `dayCurrent`/`dayTotal` (0 until start), and aggregate
  `participantCount` / `groupCount` / `organizerCount` / `checkinPct` from
  memberships + groups.
- **`toRosterParticipant(membership, user?, group?)`** → `RosterParticipant`:
  `initials`/`avatarColor` derived; `name`/`city`/`age`/`photo`/`socials` from the
  bound `user` (null-ish for `pending` rows); `groupName` denormalized.
- **`toCampGroupDetail(group, members)`** → `CampGroupDetail`: `memberCount`,
  `leaderName` from the leader membership, `members[]` with `isLeader`.
- **`toAnnouncement(doc, author)`** → resolves `scope` (camp vs `{group, groupName}`)
  and the `author` join.
- **`toActivity(doc)`** → resolves `scope`; ISO 8601 UTC timestamps.
- **`toLeaderboard(groupPoints[], groups, callerGroupId)`** → `Leaderboard`: raw
  `score`/`previousScore`/`breakdown` per group + `currentGroupId`. Ranks/trends are
  derived on the client (`deriveLeaderboard()` already exists).

---

## 8. Frontend migration seam

Each frontend service flips mock → real by uncommenting the axios line and deleting
the mock branch — no UI change (the contracts are already the return types). Per the
Frontend CLAUDE.md, `lib/leaderboard.ts` also **migrates** from the old `lib/` shape
into an `api/services/leaderboard.service.ts` + `api/queries/leaderboard.queries.ts`
pair at that point.

The `CURRENT_CAMP_ID = 'current'` placeholder in `announcements.service.ts` is
resolved when the organizer opens a specific camp (campDetail context already passes
a real `campId`); the queries already key by `campId`, so nothing else changes.

---

## 9. Conventions (must follow)

- Layering `routes → controllers → services → models`; thin controllers (no
  try/catch); throw `new HttpError(status, message)`.
- Every input a Zod schema in `validators/`, applied via `validate({...})`. Import
  `z` from `config/zod`.
- Register every endpoint in `docs/openapi.ts` reusing validator schemas.
- New middleware file `campScope.middleware.ts`; new domains follow the
  `*.routes.ts / *.controllers.ts / *.services.ts / *.validators.ts` naming.

---

## 10. Out of scope

- **Realtime** (group chat, SOS, live map) — separate designs; the leaderboard/
  announcement realtime nudges come later via `PointEvent`/socket. REST only now.
- **Granular sub-role permissions** — captured on `Membership.role`, not enforced
  (post-launch, CONTEXT §7).
- **Analytics**, cross-camp participant portal (CONTEXT §7).
- Camp cover **image upload** pipeline — endpoints accept a URL string; the upload/
  storage mechanism is a separate concern.

---

## 11. Risks & gotchas

- **Stale Mongo indexes** (Backend CLAUDE.md): new unique/compound indexes
  (`Membership {campId, phone}`) are fine on a fresh DB; if reusing a dev DB, watch
  for lingering indexes.
- **≤2-camps race**: enforce in the service with a count check; the `{phone, role}`
  index keeps it cheap. Acceptable for launch scale (no distributed lock).
- **Pending-row projection**: `RosterParticipant` requires `name`/`city`/`age`;
  for `pending` memberships these come back empty/placeholder until signup binds the
  user. The roster UI must tolerate this (it will show phone + group + a pending
  badge).
- **Auth binding touch-point**: signup/login gains a membership-binding step. Keep
  it idempotent and additive so the existing `/login`/`/register`/`/me` shapes are
  unchanged.

---

## 12. Verification (no test runner — project preference)

Manual, per Backend CLAUDE.md: `npm run typecheck` per change (primary gate), then
exercise each endpoint via `/api/docs` (Swagger) or curl with a real session cookie.
Seed an organization (`npm run seed:org`), create an organizer, then walk the full
flow: create camp → group → add participant by phone → schedule → announcement →
leaderboard adjust → verify the participant read projections.
