# Participant Live Camp Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-in participant sees their real camp — name, dates, day counter, cover, group, schedule, announcements, standings — instead of mock data and a placeholder camp id.

**Architecture:** The backend gains one self-scoped endpoint (`GET /api/me/camps`) that tells a participant which camp they belong to, plus a privacy-narrow `GET /api/camps/:id/my-group`. The frontend resolves the camp **once** in `ParticipantDashboard` and passes a real ObjectId down through the existing `CampContext`; the placeholder `CURRENT_CAMP_ID` is deleted and `campId` becomes a required parameter, so a screen that forgets to thread it fails typecheck rather than 400ing at runtime.

**Tech Stack:** Backend — Express 5, Mongoose 9, Zod 4, TypeScript (strict, CommonJS). Frontend — React, Vite, TypeScript, Tailwind, React Query, Zustand, react-router-dom.

**Spec:** `docs/superpowers/specs/2026-07-18-participant-live-camp-data-design.md`

## Global Constraints

- **Two separate git repos.** `frontend/` and `backend/` are independent repos; the monorepo root is **not** a repo. Commit from inside each directory. This plan file lives at the uncommittable root.
- **No test runner exists in either repo** (project preference). Do **not** add one, and do not write test files. Each task verifies via `npm run validate` plus an explicit curl or browser check.
- **`npm run validate`** (lint + format:check + typecheck) is the per-change gate in both repos. It must pass before every commit.
- **Backend layering:** `routes → controllers → services → models`. Controllers are thin with **no try/catch** (Express 5 forwards async throws). Business logic lives in services. Throw `new HttpError(status, message)`.
- **Backend validation:** every input gets a Zod schema in `validators/`, applied via `validate({ body, params, query })`. Import `z` from `../config/zod`, **never** from `'zod'`.
- **Backend docs:** every new endpoint gets a `registry.registerPath(...)` in `docs/openapi.ts`, reusing validator schemas.
- **Trilingual by default.** Every user-facing string ships EN/UZ/RU in `i18n/translations.ts`. No hard-coded copy.
- **Design system only.** No rogue colors. Group avatar colors are palette **tokens** resolved to `var(--color-<token>)`, never raw hex — this is what keeps dark mode correct.
- **Privacy guardrail.** Participant-facing payloads never carry another member's phone, full name, or user id.
- **Frontend rule:** never inline a `['...']` React Query key — pull it from a factory in `api/queryKeys.ts`.

---

## File Structure

**Backend (`backend/`)**

| Path | Responsibility |
|---|---|
| `src/services/camp.services.ts` (modify) | add `toParticipantCamp` — camp projection with no roster counts |
| `src/services/membership.services.ts` (modify) | add `listParticipantCamps` — resolve a user's published camps |
| `src/services/group.services.ts` (modify) | add `toMyGroup` — privacy-narrow own-group projection |
| `src/controllers/me.controllers.ts` (create) | thin controller for `/me/camps` |
| `src/routes/me.routes.ts` (create) | `/me` router |
| `src/controllers/group.controllers.ts` (modify) | add `getMyGroup` handler |
| `src/routes/camp.routes.ts` (modify) | mount `my-group` on the shared read router |
| `src/routes/index.ts` (modify) | mount `/me` |
| `src/docs/openapi.ts` (modify) | register both endpoints |

**Frontend (`frontend/`)**

| Path | Responsibility |
|---|---|
| `src/api/services/me.service.ts` (create) | `GET /me/camps` boundary + `ParticipantCamp` type |
| `src/api/queries/me.queries.ts` (create) | `useMyCamps()` |
| `src/api/services/participantCamp.service.ts` (create) | `GET /camps/:id` + `GET /camps/:id/my-group` boundaries |
| `src/api/queries/participantCamp.queries.ts` (create) | `useCampDetail()`, `useMyGroup()` |
| `src/api/queryKeys.ts` (modify) | add root-level `participantKeys` |
| `src/utils/paletteColor.ts` (create) | palette token → `var(--color-*)` |
| `src/lib/campHome.ts` (modify) | becomes a composer over the two queries |
| `src/components/participant/campContext.ts` (modify) | `campId` added to `CampContext` |
| `src/components/participant/ParticipantDashboard.tsx` (modify) | resolves the camp; gates `<Outlet>` |
| `src/components/participant/NoCampScreen.tsx` (create) | empty state when no camp resolves |
| `src/components/participant/home/MyGroupCard.tsx` (modify) | unassigned branch |
| `src/i18n/translations.ts` (modify) | `noCamp` strings ×3 languages |
| `src/api/services/announcements.service.ts` (modify) | delete `CURRENT_CAMP_ID` |
| `src/api/queries/{announcements,schedule,leaderboard}.queries.ts` (modify) | `campId` becomes required |
| `src/api/services/schedule.service.ts` (modify) | `campId` becomes required |
| Participant screens (modify) | thread `campId` from context |

---

## Task 1: Backend — `GET /api/me/camps`

**Files:**
- Modify: `backend/src/services/camp.services.ts`
- Modify: `backend/src/services/membership.services.ts`
- Create: `backend/src/controllers/me.controllers.ts`
- Create: `backend/src/routes/me.routes.ts`
- Modify: `backend/src/routes/index.ts`

**Interfaces:**
- Consumes: existing `dayProgress`, `deriveStatus`, `fmt` helpers in `camp.services.ts`; `CampModel`, `MembershipModel`.
- Produces: `toParticipantCamp(camp: Camp) => ParticipantCampDTO` (synchronous — no DB calls, unlike `toOrganizerCamp`); `membershipService.listParticipantCamps(userId: Types.ObjectId) => Promise<ParticipantCampDTO[]>`; route `GET /api/me/camps`.

- [ ] **Step 1: Add the `toParticipantCamp` projection**

In `backend/src/services/camp.services.ts`, directly after the existing `toOrganizerCamp` function (ends line ~61), add:

```ts
/*
  The PARTICIPANT projection of a camp. Deliberately NOT toOrganizerCamp: that one
  spreads ...campCounts (participantCount, organizerCount, groupCount, checkedIn),
  none of which a participant may see. Synchronous, because without the counts
  there is nothing left to query.
*/
export function toParticipantCamp(camp: Camp) {
  return {
    id: String(camp._id),
    name: camp.name,
    location: camp.location,
    dateRange: `${fmt(camp.startsAt)} – ${fmt(camp.endsAt)}`,
    startsAt: camp.startsAt.toISOString(),
    endsAt: camp.endsAt.toISOString(),
    status: deriveStatus(camp),
    coverImage: camp.coverImage ?? null,
    ...dayProgress(camp),
  }
}
```

- [ ] **Step 2: Add the membership lookup**

In `backend/src/services/membership.services.ts`, add the import and the method:

```ts
import { Types } from 'mongoose'
import { MembershipModel } from '../models/membership.model'
import { CampModel } from '../models/camp.model'
import { toParticipantCamp } from './camp.services'
```

Add inside the `membershipService` object:

```ts
  /*
    Every PUBLISHED camp this user participates in, soonest first.

    Query by userId, NOT phone: requireCampMember resolves membership with
    { campId, userId }, so matching on phone here could list a camp whose
    unbound row (userId: null) then 403s on every camp-scoped call — a camp
    visible in the UI that nothing can load. bindPhone sets userId at login.

    Draft camps are excluded: draft means "not ready", and organizers stage
    rosters before publishing.
  */
  listParticipantCamps: async (userId: Types.ObjectId) => {
    const memberships = await MembershipModel.find({
      userId,
      role: 'participant',
      status: 'active',
    }).select('campId')
    if (memberships.length === 0) return []

    const camps = await CampModel.find({
      _id: { $in: memberships.map((m) => m.campId) },
      status: 'published',
    }).sort({ startsAt: 1 })

    return camps.map(toParticipantCamp)
  },
```

- [ ] **Step 3: Add the controller**

Create `backend/src/controllers/me.controllers.ts`:

```ts
import type { RequestHandler } from 'express'
import { membershipService } from '../services/membership.services'
import { HttpError } from '../middlewares/error.middleware'

/*
  The caller's own camps. Self-scoped by definition — requireAuth is the only
  guard, because the answer is derived from who you are, not from a role rank.
  An empty list is a valid 200, not a 404: a rostered-but-unpublished or
  not-yet-assigned participant is a normal state the UI renders as NoCampScreen.
*/
export const listMyCamps: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated')
  const camps = await membershipService.listParticipantCamps(req.auth.user._id)
  res.json(camps)
}
```

- [ ] **Step 4: Add the route**

Create `backend/src/routes/me.routes.ts`:

```ts
import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware'
import { listMyCamps } from '../controllers/me.controllers'

// The caller's own view of their memberships. No requireRole: this router is
// self-scoped, so every authenticated role resolves only its own rows.
const router = Router()
router.use(requireAuth)
router.get('/camps', listMyCamps)

export default router
```

- [ ] **Step 5: Mount it**

In `backend/src/routes/index.ts`, add the import beside the others:

```ts
import meRoutes from './me.routes'
```

and mount it after the `/invite` line:

```ts
router.use('/me', meRoutes)
```

- [ ] **Step 6: Verify it compiles**

Run: `cd backend && npm run validate`
Expected: PASS — no lint, format, or type errors.

- [ ] **Step 7: Verify the endpoint by hand**

Start the API (`cd backend && npm run dev`, requires `MONGO_URI`). Log in as a participant who is on a **published** camp's roster, saving the cookie:

```bash
curl -s -c /tmp/p.txt -X POST localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"<rostered participant phone>"}'

curl -s -b /tmp/p.txt localhost:4000/api/me/camps
```

Expected: a JSON **array** with one camp object carrying `id`, `name`, `location`, `dateRange`, `startsAt`, `endsAt`, `status`, `coverImage`, `dayCurrent`, `dayTotal` — and **no** `participantCount`, `organizerCount`, `groupCount`, or `checkinPct`. Confirm those four are absent; their presence means `toOrganizerCamp` was reused by mistake.

Then set that camp to `status: 'draft'` in Mongo and re-run: expected `[]`.

- [ ] **Step 8: Commit**

```bash
cd backend
git add src/services/camp.services.ts src/services/membership.services.ts \
        src/controllers/me.controllers.ts src/routes/me.routes.ts src/routes/index.ts
git commit -m "feat(me): GET /me/camps resolves a participant's published camps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend — `GET /api/camps/:id/my-group`

**Files:**
- Modify: `backend/src/services/group.services.ts`
- Modify: `backend/src/controllers/group.controllers.ts`
- Modify: `backend/src/routes/camp.routes.ts`

**Interfaces:**
- Consumes: `req.membership` (set by `requireCampMember`); `initialsOf`, `colorFor` from `utils/avatar`.
- Produces: `toMyGroup(group: Group) => Promise<MyGroupDTO>` where `MyGroupDTO = { id, name, color, photo, memberCount, members: { initials, color }[] }`; handler `getMyGroup`; route `GET /api/camps/:id/my-group` returning `{ group: MyGroupDTO | null }`.

- [ ] **Step 1: Add the privacy-narrow projection**

In `backend/src/services/group.services.ts`, add after the existing `toCampGroupDetail` function:

```ts
/*
  The PARTICIPANT's view of their OWN group.

  Deliberately NOT toCampGroupDetail: that projection returns each member's full
  name and membership id, and falls back to m.phone as the display name when a
  member has no bound user. Correct for the organizer's roster; a privacy leak in
  a card every group member can see. Here: initials and a palette token, nothing else.

  `color` is a palette TOKEN ('pine' | 'amber' | 'sky' | 'deep'), not hex — the
  client resolves it to var(--color-<token>) so dark mode keeps working.
*/
export async function toMyGroup(group: Group) {
  const memberships = await MembershipModel.find({
    groupId: group._id,
    role: 'participant',
  }).select('_id userId')

  const members = await Promise.all(
    memberships.map(async (m) => {
      const user = m.userId ? await UserModel.findById(m.userId).select('name surname') : null
      // name/surname stay optional until completeProfile, so a claimed participant
      // can be nameless. Never fall back to the phone — this list is group-visible.
      const label = user ? `${user.name ?? ''} ${user.surname ?? ''}`.trim() : ''
      return {
        initials: label ? initialsOf(label) : '?',
        color: colorFor(String(m._id)),
      }
    }),
  )

  return {
    id: String(group._id),
    name: group.name,
    color: group.color,
    photo: group.photo ?? null,
    memberCount: members.length,
    members,
  }
}
```

- [ ] **Step 2: Add the controller handler**

In `backend/src/controllers/group.controllers.ts`, add the import for `toMyGroup` alongside the existing service imports, then add:

```ts
/*
  The caller's own group in this camp. groupId comes from the caller's own
  membership row (resolved by requireCampMember), so no request parameter can
  steer this toward another group's roster — the privacy boundary is structural.

  Unassigned is a valid state, not an error: an organizer may add a participant
  to a roster before sorting groups, so this returns { group: null } with 200.
*/
export const getMyGroup: RequestHandler = async (req, res) => {
  const groupId = req.membership?.groupId
  if (!groupId) {
    res.json({ group: null })
    return
  }
  const group = await GroupModel.findById(groupId)
  if (!group) {
    res.json({ group: null })
    return
  }
  res.json({ group: await toMyGroup(group) })
}
```

If `GroupModel` and `RequestHandler` are not already imported in that file, add:

```ts
import type { RequestHandler } from 'express'
import { GroupModel } from '../models/group.model'
import { toMyGroup } from '../services/group.services'
```

- [ ] **Step 3: Mount the route on the shared read router**

In `backend/src/routes/camp.routes.ts`, add to the imports:

```ts
import { getMyGroup } from '../controllers/group.controllers'
```

Then add to the `campRouter` block (after the `getCamp` line, before the `.use` mounts):

```ts
campRouter.get(
  '/:id/my-group',
  requireAuth,
  validate({ params: campIdParam }),
  requireCampMember,
  getMyGroup,
)
```

Note this goes on `campRouter` (the shared read projection), **not** `organizerCampRouter` — participants must reach it.

- [ ] **Step 4: Verify it compiles**

Run: `cd backend && npm run validate`
Expected: PASS.

- [ ] **Step 5: Verify by hand**

Using the cookie jar and the camp id from Task 1:

```bash
curl -s -b /tmp/p.txt localhost:4000/api/camps/<campId>/my-group
```

Expected for an assigned participant: `{"group":{"id":"…","name":"…","color":"pine","photo":null,"memberCount":N,"members":[{"initials":"AR","color":"sky"}, …]}}`.

Verify **no** member object contains `name`, `phone`, or `id`. Verify `color` is a token like `pine`, not a hex string.

Then clear that participant's `groupId` in Mongo and re-run: expected `{"group":null}` with status **200**, not 404.

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/services/group.services.ts src/controllers/group.controllers.ts src/routes/camp.routes.ts
git commit -m "feat(camps): GET /camps/:id/my-group returns the caller's own group

Initials + palette token only -- never another member's name or phone.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Backend — OpenAPI registration

**Files:**
- Modify: `backend/src/docs/openapi.ts`

**Interfaces:**
- Consumes: `campIdParam` from `validators/camp.validators`; the `registry` object already in `openapi.ts`.
- Produces: no code interface — documentation only.

- [ ] **Step 1: Register both endpoints**

Open `backend/src/docs/openapi.ts` and match the surrounding `registry.registerPath(...)` style already in the file (reuse its existing response-schema helpers if it has them; the shapes below are the contract to express).

```ts
registry.registerPath({
  method: 'get',
  path: '/me/camps',
  tags: ['Me'],
  summary: "The caller's own published camps",
  description:
    'Self-scoped. Returns every published camp the caller participates in, soonest first. An empty array is a valid response.',
  responses: {
    200: { description: 'Camps the caller participates in' },
    401: { description: 'Not authenticated' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/camps/{id}/my-group',
  tags: ['Camps'],
  summary: "The caller's own group within a camp",
  description:
    'Returns initials and a palette token per member -- never another member\'s name or phone. `group` is null when the caller has not been assigned a group.',
  request: { params: campIdParam },
  responses: {
    200: { description: "The caller's group, or null" },
    403: { description: 'Not a member of this camp' },
    404: { description: 'Camp not found' },
  },
})
```

- [ ] **Step 2: Verify the docs render**

Run: `cd backend && npm run validate` — expected PASS.

Then with the dev server running, open `http://localhost:4000/api/docs` and confirm both `/me/camps` and `/camps/{id}/my-group` appear.

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/docs/openapi.ts
git commit -m "docs(openapi): register /me/camps and /camps/:id/my-group

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — camp resolution data layer

**Files:**
- Create: `frontend/src/api/services/me.service.ts`
- Create: `frontend/src/api/queries/me.queries.ts`
- Create: `frontend/src/api/services/participantCamp.service.ts`
- Create: `frontend/src/api/queries/participantCamp.queries.ts`
- Modify: `frontend/src/api/queryKeys.ts`

**Interfaces:**
- Consumes: `axiosInstance` from `../axiosInstance`; `campKeys` from `../queryKeys`.
- Produces: type `ParticipantCamp`; type `MyGroup`; `meService.camps()`; `participantCampService.get(campId)`; `participantCampService.myGroup(campId)`; hooks `useMyCamps()`, `useCampDetail(campId)`, `useMyGroup(campId)`; key factory `participantKeys.camps`; key `campKeys.myGroup(campId)`.

- [ ] **Step 1: Add the query keys**

In `frontend/src/api/queryKeys.ts`, add above the `campKeys` block:

```ts
/*
  The PARTICIPANT's own cross-camp reads. Root-level, NOT under campKeys: this is
  the query that determines WHICH camp you are in, so nesting it under a campId
  would be circular.
*/
export const participantKeys = {
  all: ['participant'] as const,
  /** The camps this participant belongs to — resolves the active campId. */
  camps: ['participant', 'camps'] as const,
}
```

And add one entry inside the existing `campKeys` object, after `groups`:

```ts
  /** The caller's OWN group in this camp (participant projection). */
  myGroup: (campId: string) => [...campKeys.all(campId), 'myGroup'] as const,
```

- [ ] **Step 2: Create the me service**

Create `frontend/src/api/services/me.service.ts`:

```ts
import { axiosInstance } from '../axiosInstance'

/*
  The ME service — the caller's own cross-camp reads. This is the boundary that
  answers "which camp am I in", which every other participant query depends on.
  No React here.
*/

/** A camp as the PARTICIPANT sees it — no roster counts (that's the organizer's view). */
export type ParticipantCamp = {
  id: string
  name: string
  location: string
  /** Human date range, formatted server-side, e.g. "Jul 6 – Jul 19". */
  dateRange: string
  startsAt: string
  endsAt: string
  status: 'active' | 'upcoming' | 'archived'
  coverImage: string | null
  /** Day N of M — 0 until the camp starts. */
  dayCurrent: number
  dayTotal: number
}

export const meService = {
  /** Every published camp the caller participates in, soonest first. May be empty. */
  camps: async (): Promise<ParticipantCamp[]> =>
    (await axiosInstance.get<ParticipantCamp[]>('/me/camps')).data,
}
```

- [ ] **Step 3: Create the me query**

Create `frontend/src/api/queries/me.queries.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { meService } from '../services/me.service'
import { participantKeys } from '../queryKeys'

/*
  The participant's camps. Called ONCE in ParticipantDashboard, which resolves the
  active camp and shares its id through CampContext — screens never call this
  directly. The payload is list-shaped so a camp switcher is later UI-only work.
*/
export function useMyCamps() {
  return useQuery({
    queryKey: participantKeys.camps,
    queryFn: () => meService.camps(),
  })
}
```

- [ ] **Step 4: Create the participant camp service**

Create `frontend/src/api/services/participantCamp.service.ts`:

```ts
import { axiosInstance } from '../axiosInstance'
import type { ParticipantCamp } from './me.service'

/*
  The participant's per-camp reads: the camp header and their own group. These hit
  the SHARED read routes (/camps/:id/...), not the organizer projection — same
  underlying entity, narrower slice. No React here.
*/

/** One member of your group. Initials + palette token only — never a name or phone. */
export type MyGroupMember = {
  initials: string
  /** Palette TOKEN ('pine' | 'amber' | 'sky' | 'deep') — resolve via paletteColor(). */
  color: string
}

export type MyGroup = {
  id: string
  name: string
  /** Palette token — resolve via paletteColor() before using as a style value. */
  color: string
  photo: string | null
  memberCount: number
  members: MyGroupMember[]
}

export const participantCampService = {
  get: async (campId: string): Promise<ParticipantCamp> =>
    (await axiosInstance.get<ParticipantCamp>(`/camps/${campId}`)).data,

  /** null when the participant has not been assigned a group yet — a valid state. */
  myGroup: async (campId: string): Promise<MyGroup | null> =>
    (await axiosInstance.get<{ group: MyGroup | null }>(`/camps/${campId}/my-group`)).data.group,
}
```

- [ ] **Step 5: Create the participant camp queries**

Create `frontend/src/api/queries/participantCamp.queries.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { participantCampService } from '../services/participantCamp.service'
import { campKeys } from '../queryKeys'

/*
  Named useCampDetail, NOT useCamp — campContext.ts already exports useCamp() for
  the outlet context, and two hooks named useCamp in the participant tree is a
  collision waiting to confuse someone.
*/
export function useCampDetail(campId: string) {
  return useQuery({
    queryKey: campKeys.all(campId),
    queryFn: () => participantCampService.get(campId),
    enabled: Boolean(campId),
  })
}

/** The caller's own group. Resolves to null when unassigned — not an error. */
export function useMyGroup(campId: string) {
  return useQuery({
    queryKey: campKeys.myGroup(campId),
    queryFn: () => participantCampService.myGroup(campId),
    enabled: Boolean(campId),
  })
}
```

- [ ] **Step 6: Verify it compiles**

Run: `cd frontend && npm run validate`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/api/services/me.service.ts src/api/queries/me.queries.ts \
        src/api/services/participantCamp.service.ts \
        src/api/queries/participantCamp.queries.ts src/api/queryKeys.ts
git commit -m "feat(participant): data layer for camp resolution and own-group

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — NoCampScreen and its translations

**Files:**
- Create: `frontend/src/components/participant/NoCampScreen.tsx`
- Modify: `frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `useTranslation` from `../../i18n/useTranslation`.
- Produces: `<NoCampScreen />` (no props); translation group `t.noCamp` with keys `title`, `body`, `hint`.

- [ ] **Step 1: Add the translation type**

In `frontend/src/i18n/translations.ts`, add near the other screen string types (e.g. after `CommonStrings` around line 260):

```ts
// Shown to a logged-in participant with no published camp — pre-assignment,
// or after their camp is archived.
type NoCampStrings = {
  title: string
  body: string
  hint: string
}
```

- [ ] **Step 2: Register it on the strings interface**

In the same file, in the block listing `common: CommonStrings` etc. (around line 644), add:

```ts
    noCamp: NoCampStrings
```

- [ ] **Step 3: Add all three languages**

Add a `noCamp` block to each of the `uz`, `ru`, and `en` translation objects. TypeScript enforces all three, so a missing one is a compile error.

```ts
// uz
    noCamp: {
      title: 'Hozircha lager yoʻq',
      body: 'Siz hali birorta lagerga qoʻshilmagansiz. Tashkilotchi sizni qoʻshgach, hammasi shu yerda paydo boʻladi.',
      hint: 'Lager boshlanishiga yaqin qayta tekshiring.',
    },

// ru
    noCamp: {
      title: 'Пока нет лагеря',
      body: 'Вы ещё не добавлены ни в один лагерь. Как только организатор добавит вас, всё появится здесь.',
      hint: 'Загляните снова ближе к началу лагеря.',
    },

// en
    noCamp: {
      title: 'No camp yet',
      body: "You haven't been added to a camp yet. Once an organizer adds you, everything will show up here.",
      hint: 'Check back closer to your camp start date.',
    },
```

- [ ] **Step 4: Create the component**

Create `frontend/src/components/participant/NoCampScreen.tsx`:

```tsx
import { useTranslation } from '../../i18n/useTranslation'

/*
  A logged-in participant with no published camp. Distinct from ComingSoon (which
  means "feature not built") — this is a real, expected state: rostered before the
  camp is published, not yet assigned, or the camp was archived.

  The shell hides the bottom nav and SOS button behind this screen: there is no
  camp to navigate within, and no organizer to signal.
*/
export function NoCampScreen() {
  const { t } = useTranslation()

  return (
    <div className="flex h-full flex-col items-center justify-center bg-canvas px-8 text-center">
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[26px] bg-green-tint text-4xl">
        ⛺️
      </div>
      <h1 className="font-display text-xl font-bold tracking-tight text-content">
        {t.noCamp.title}
      </h1>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">{t.noCamp.body}</p>
      <p className="mt-4 text-xs text-muted">{t.noCamp.hint}</p>
    </div>
  )
}
```

- [ ] **Step 5: Verify**

Run: `cd frontend && npm run validate`
Expected: PASS. A missing language block surfaces here as a type error.

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/components/participant/NoCampScreen.tsx src/i18n/translations.ts
git commit -m "feat(participant): NoCampScreen with EN/UZ/RU copy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — resolve the camp in the shell

**Files:**
- Modify: `frontend/src/components/participant/campContext.ts`
- Modify: `frontend/src/components/participant/ParticipantDashboard.tsx`

**Interfaces:**
- Consumes: `useMyCamps()` (Task 4); `<NoCampScreen />` (Task 5).
- Produces: `CampContext.campId: string` — every `/camp/*` screen may treat it as a guaranteed non-empty ObjectId.

- [ ] **Step 1: Add `campId` to the context type**

In `frontend/src/components/participant/campContext.ts`, add the field to `CampContext`:

```ts
export type CampContext = {
  /*
    The active camp's real ObjectId. Guaranteed non-empty: the shell does not
    render <Outlet> until resolution succeeds, so no screen needs a no-camp branch.
  */
  campId: string
  sos: ReturnType<typeof useSos>
  goSchedule: () => void
  goAnnouncements: () => void
  goChat: () => void
  logout: () => void
}
```

- [ ] **Step 2: Resolve the camp in the shell**

In `frontend/src/components/participant/ParticipantDashboard.tsx`, add the imports:

```ts
import { useMyCamps } from '../../api/queries/me.queries'
import { NoCampScreen } from './NoCampScreen'
```

Replace the body of `ParticipantDashboard` from the `const { data: home } = useCampHome()` line through the `return (` statement with:

```tsx
  const { data: camps, isPending } = useMyCamps()

  // One active camp for now; the payload is list-shaped so a switcher is later
  // UI-only work. Resolving HERE (the one component wrapping every /camp/* route)
  // means screens read a guaranteed campId instead of each handling absence.
  const camp = camps?.[0]

  // Same cached query HomeScreen uses — here just for the Chat tab's unread badge.
  const { data: home } = useCampHome(camp?.id ?? '')

  if (isPending) {
    return (
      <div className="relative mx-auto flex h-dvh w-full max-w-2xl flex-col overflow-hidden bg-canvas shadow-sm">
        <HomeSkeleton />
      </div>
    )
  }

  if (!camp) {
    // No bottom nav, no SOS: nothing to navigate within, no organizer to signal.
    return (
      <div className="relative mx-auto flex h-dvh w-full max-w-2xl flex-col overflow-hidden bg-canvas shadow-sm">
        <NoCampScreen />
      </div>
    )
  }

  const onHome = location.pathname === '/camp/home'
  const onChat = location.pathname === '/camp/chat'

  // Opening Chat "reads" it — clear the unread badge. Real read-state is server-
  // owned; this is the client stand-in until then.
  const chatBadge = onChat ? undefined : home?.unreadChat

  const ctx: CampContext = {
    campId: camp.id,
    sos,
    goSchedule: () => navigate('/camp/schedule'),
    goAnnouncements: () => navigate('/camp/announcements'),
    goChat: () => navigate('/camp/chat'),
    logout: () => logout.mutate(),
  }

  return (
```

Add the `HomeSkeleton` import alongside the others:

```ts
import { HomeSkeleton } from './HomeSkeleton'
```

The JSX after `return (` is unchanged.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run validate`

Expected: **FAIL**, with type errors in `lib/campHome.ts` (`useCampHome` does not yet take an argument). That is correct at this point — Task 7 changes it. Do not commit yet; proceed to Task 7 and commit them together.

---

## Task 7: Frontend — campHome becomes a composer

**Files:**
- Create: `frontend/src/utils/paletteColor.ts`
- Modify: `frontend/src/lib/campHome.ts`
- Modify: `frontend/src/components/participant/home/MyGroupCard.tsx`

**Interfaces:**
- Consumes: `useCampDetail(campId)`, `useMyGroup(campId)` (Task 4).
- Produces: `paletteColor(token: string) => string`; `useCampHome(campId: string)` returning `{ data: CampHome | undefined, isPending, isError }`; `CampHome['group']` becomes nullable.

- [ ] **Step 1: Add the palette token resolver**

Create `frontend/src/utils/paletteColor.ts`:

```ts
/*
  Palette TOKEN → CSS variable reference.

  The server stores and returns group colors as design-system tokens ('pine',
  'amber', …), never hex. Resolving to var(--color-<token>) is what keeps group
  avatars correct in DARK MODE — index.css redefines these variables per theme,
  so a raw hex from the server would freeze them to the light palette.

  Unknown tokens fall back to pine rather than rendering a transparent tile.
*/
const PALETTE_TOKENS = ['pine', 'amber', 'sky', 'deep'] as const

export function paletteColor(token: string): string {
  const safe = (PALETTE_TOKENS as readonly string[]).includes(token) ? token : 'pine'
  return `var(--color-${safe})`
}
```

- [ ] **Step 2: Rewrite campHome as a composer**

Replace the whole contents of `frontend/src/lib/campHome.ts`:

```ts
import { useCampDetail, useMyGroup } from '@/api/queries/participantCamp.queries'
import { paletteColor } from '@/utils/paletteColor'

/*
  The DATA CONTRACT for the participant home. These types describe the shape the
  ORGANIZER's data fills in — the camp name/dates, the group they assign.
  Components depend on these shapes, never on where the data comes from.
*/
export type GroupMember = {
  initials: string
  /** Resolved CSS color (var(--color-*)) — consumers apply it as an inline style. */
  color: string
}

export type CampHome = {
  camp: {
    name: string
    location: string
    dateRange: string
    dayCurrent: number
    dayTotal: number
    coverImage: string
  }
  /** null when the organizer hasn't assigned this participant to a group yet. */
  group: {
    name: string
    memberCount: number
    members: GroupMember[]
  } | null
  /** Unread group-chat messages — drives the Chat tab badge. */
  unreadChat: number
}

/*
  Home is COMPOSED, not a bespoke endpoint: the camp header and the group come
  from two existing routes that cache and invalidate at different rates. React
  Query dedupes both across every component that asks, so HomeScreen and the
  bottom-nav badge still share one request each.

  unreadChat stays client-side — chat has no server-owned read state yet, so
  faking it into this payload would invent a contract the backend doesn't honor.
*/
export function useCampHome(campId: string) {
  const camp = useCampDetail(campId)
  const group = useMyGroup(campId)

  const isPending = camp.isPending || group.isPending
  const isError = camp.isError || group.isError

  const data: CampHome | undefined =
    camp.data && !isPending
      ? {
          camp: {
            name: camp.data.name,
            location: camp.data.location,
            dateRange: camp.data.dateRange,
            dayCurrent: camp.data.dayCurrent,
            dayTotal: camp.data.dayTotal,
            // Organizer-uploaded cover; fall back to the bundled default.
            coverImage: camp.data.coverImage ?? '/camp-cover.jpg',
          },
          group: group.data
            ? {
                name: group.data.name,
                memberCount: group.data.memberCount,
                members: group.data.members.map((m) => ({
                  initials: m.initials,
                  color: paletteColor(m.color),
                })),
              }
            : null,
          unreadChat: 0,
        }
      : undefined

  return { data, isPending, isError }
}
```

- [ ] **Step 3: Handle the unassigned group in the card**

In `frontend/src/components/participant/home/MyGroupCard.tsx`, change the `Props` type and add the empty branch at the top of the component:

```tsx
type Props = {
  group: CampHome['group']
  /** Open the group / chat. */
  onOpen: () => void
}
```

Immediately after `const { t } = useTranslation()`, add:

```tsx
  // Unassigned is a normal state: an organizer can roster a participant before
  // sorting groups. Show a calm placeholder rather than hiding the card, so the
  // participant knows grouping is coming.
  if (!group) {
    return (
      <div className="flex items-center gap-3.5 rounded-[20px] border border-line bg-surface p-4 text-left shadow-[0_4px_16px_rgba(20,40,30,0.06)]">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-soft text-[15px] font-bold text-muted">
          ?
        </div>
        <div className="flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t.home.myGroup}
          </div>
          <div className="text-base font-bold text-content">{t.home.noGroupYet}</div>
        </div>
      </div>
    )
  }
```

- [ ] **Step 4: Add the `noGroupYet` string in all three languages**

In `frontend/src/i18n/translations.ts`, add `noGroupYet: string` to the `HomeStrings` type (around line 129), then add the value to each language's `home` block:

```ts
// uz
      noGroupYet: 'Guruh hali tayinlanmagan',
// ru
      noGroupYet: 'Группа ещё не назначена',
// en
      noGroupYet: 'Not assigned to a group yet',
```

- [ ] **Step 5: Pass campId in HomeScreen**

In `frontend/src/components/participant/HomeScreen.tsx`, change the destructure and the three hook calls:

```tsx
  const { campId, goSchedule, goAnnouncements, goChat } = useCamp()
  const { data, isPending, isError } = useCampHome(campId)
  const { data: schedule, isPending: schedulePending } = useSchedule(campId)
  const { data: announcements } = useAnnouncements(campId)
```

- [ ] **Step 6: Verify**

Run: `cd frontend && npm run validate`

Expected: **PASS** for `campHome.ts`, `MyGroupCard.tsx`, and `ParticipantDashboard.tsx`. Remaining errors, if any, should only be in screens still calling the camp hooks without an argument — Task 8 fixes those. If `campHome.ts` itself still errors, stop and resolve before continuing.

- [ ] **Step 7: Commit Tasks 6 + 7 together**

```bash
cd frontend
git add src/components/participant/campContext.ts \
        src/components/participant/ParticipantDashboard.tsx \
        src/utils/paletteColor.ts src/lib/campHome.ts \
        src/components/participant/home/MyGroupCard.tsx src/i18n/translations.ts \
        src/components/participant/HomeScreen.tsx
git commit -m "feat(participant): resolve the camp in the shell, compose home from live data

campHome stops returning mock data and composes GET /camps/:id with
GET /camps/:id/my-group. Group colors resolve through design-system
tokens so dark mode keeps working.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Frontend — delete `CURRENT_CAMP_ID`, thread `campId` everywhere

**Files:**
- Modify: `frontend/src/api/services/announcements.service.ts`
- Modify: `frontend/src/api/services/schedule.service.ts`
- Modify: `frontend/src/api/queries/announcements.queries.ts`
- Modify: `frontend/src/api/queries/schedule.queries.ts`
- Modify: `frontend/src/api/queries/leaderboard.queries.ts`
- Modify: `frontend/src/components/participant/schedule/ScheduleScreen.tsx`
- Modify: `frontend/src/components/participant/announcements/AnnouncementsScreen.tsx`
- Modify: `frontend/src/components/participant/announcements/AnnouncementDetailScreen.tsx`
- Modify: `frontend/src/components/participant/ranks/RanksScreen.tsx`
- Modify: `frontend/src/components/participant/profile/ProfileScreen.tsx`

**Interfaces:**
- Consumes: `CampContext.campId` (Task 6).
- Produces: `campId` is a required first-class parameter on every camp-scoped hook and service call. No default remains anywhere.

- [ ] **Step 1: Delete the constant**

In `frontend/src/api/services/announcements.service.ts`, delete the comment block and the export at lines ~39–44:

```ts
export const CURRENT_CAMP_ID = 'current'
```

- [ ] **Step 2: Make `campId` required in the services**

In `frontend/src/api/services/schedule.service.ts`, remove the import of `CURRENT_CAMP_ID` (line 1) and change the `list` signature:

```ts
  list: async (campId: string): Promise<Activity[]> => {
    return sortByStart((await axiosInstance.get<Activity[]>(`/camps/${campId}/schedule`)).data)
  },
```

- [ ] **Step 3: Make `campId` required in the queries**

In `frontend/src/api/queries/announcements.queries.ts`, remove `CURRENT_CAMP_ID` from the import block and change all three signatures:

```ts
export function useAnnouncements(campId: string) {
export function useAnnouncement(id: string, campId: string) {
export function useCreateAnnouncement(campId: string) {
```

In `frontend/src/api/queries/schedule.queries.ts`, remove the `CURRENT_CAMP_ID` import and change:

```ts
export function useSchedule(campId: string) {
export function useCreateActivity(campId: string) {
```

In `frontend/src/api/queries/leaderboard.queries.ts`, remove the `CURRENT_CAMP_ID` import and change:

```ts
export function useLeaderboard(campId: string) {
export function useAdjustGroupPoints(campId: string) {
```

- [ ] **Step 4: Find every remaining caller**

Run: `cd frontend && grep -rn "CURRENT_CAMP_ID" src/`
Expected: **no output**. Any hit is a caller still to migrate.

Then run `npm run validate` to enumerate every screen still calling these hooks with no argument.

- [ ] **Step 5: Thread `campId` through the participant screens**

In each screen below, add `campId` to the existing `useCamp()` destructure and pass it to the hook.

`ScheduleScreen.tsx`:

```tsx
  const { campId } = useCamp()
  const { data, isPending, isError } = useSchedule(campId)
```

`AnnouncementsScreen.tsx`:

```tsx
  const { campId } = useCamp()
  const { data, isPending, isError, refetch } = useAnnouncements(campId)
```

`AnnouncementDetailScreen.tsx` — pass `campId` as the second argument to `useAnnouncement(id, campId)`.

`RanksScreen.tsx`:

```tsx
  const { campId } = useCamp()
  const { data, isPending, isError } = useLeaderboard(campId)
```

`ProfileScreen.tsx`:

```tsx
  const { campId } = useCamp()
  const { data: announcements } = useAnnouncements(campId)
```

If a screen does not already import `useCamp`, add:

```ts
import { useCamp } from '../campContext'
```

(adjusting the relative depth — screens in `participant/<sub>/` use `'../campContext'`).

- [ ] **Step 6: Migrate the organizer-side callers**

`npm run validate` will also flag organizer components calling `useCreateActivity()`, `useCreateAnnouncement()`, or `useAdjustGroupPoints()` with no argument. Those screens already know their camp from the `:campId` route param — pass it explicitly:

```tsx
const { campId } = useParams<{ campId: string }>()
const createActivity = useCreateActivity(campId ?? '')
```

Do not reintroduce a default to silence these. The whole point is that the compiler names every caller.

- [ ] **Step 7: Verify**

Run: `cd frontend && npm run validate`
Expected: PASS, with zero occurrences of `CURRENT_CAMP_ID` remaining.

- [ ] **Step 8: Commit**

```bash
cd frontend
git add -A
git commit -m "refactor(participant): campId is required, delete CURRENT_CAMP_ID

The 'current' placeholder never matched the backend's 24-hex campId
validation, so every participant camp request 400'd. Making campId
required turns a missing camp into a typecheck failure instead.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Frontend — recover from a stale membership (403)

**Files:**
- Modify: `frontend/src/api/axiosInstance.ts`

**Interfaces:**
- Consumes: `participantKeys` (Task 4); the shared `queryClient` from `api/queryClient.ts`.
- Produces: no exported interface — a response interceptor behavior.

- [ ] **Step 1: Invalidate camp resolution on 403**

In `frontend/src/api/axiosInstance.ts`, extend the existing response interceptor (match its current style; add one if none exists):

```ts
import { queryClient } from './queryClient'
import { participantKeys } from './queryKeys'

/*
  A 403 on a camp-scoped route means membership changed underneath us — removed
  from the camp, or the camp was archived. Re-resolving lands the participant on
  NoCampScreen instead of leaving them stuck on a permanent error state.

  401 is NOT handled here: that's session expiry, which the auth layer owns.
*/
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    const url: string = error?.config?.url ?? ''
    if (status === 403 && url.startsWith('/camps/')) {
      queryClient.invalidateQueries({ queryKey: participantKeys.camps })
    }
    return Promise.reject(error)
  },
)
```

If `axiosInstance.ts` already imports `queryClient`, reuse the existing import rather than duplicating it. If importing `queryClient` here creates a circular import, move this interceptor registration into `api/queryClient.ts` after the client is constructed.

- [ ] **Step 2: Verify**

Run: `cd frontend && npm run validate`
Expected: PASS.

- [ ] **Step 3: Verify by hand**

With the app running and a participant logged in on their camp, delete that participant's `Membership` row in Mongo, then trigger a refetch (switch tabs, or pull to refresh).
Expected: the app lands on `NoCampScreen` rather than showing a stuck error.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/api/axiosInstance.ts
git commit -m "fix(participant): re-resolve camp on 403 instead of stalling

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: End-to-end verification

**Files:** none — verification only.

**Interfaces:**
- Consumes: everything above.
- Produces: a signed-off feature.

- [ ] **Step 1: Seed the scenario**

With MongoDB running and `npm run seed:org` already applied, create through the organizer UI (or API): one camp with `status: 'published'`, at least two groups, and at least three participant phones on the roster, one of them left **unassigned** to any group.

- [ ] **Step 2: Verify the happy path**

Log in to the participant app with an **assigned** rostered phone. Confirm on Home:

- camp name is the real camp, not "Yoshlar Summer Camp 2026"
- location and date range match what the organizer entered
- the day counter reads the real "Day N of M"
- the group card shows the real group name and member count
- avatars render with visible background colors (not transparent — a transparent tile means a raw token reached the inline style without `paletteColor()`)

- [ ] **Step 3: Verify the other screens**

Navigate to Schedule, Announcements, and Ranks. Each shows that camp's real data. Confirm the browser network tab shows requests to `/camps/<24-hex-id>/…` and **no** request to `/camps/current/…`.

- [ ] **Step 4: Verify dark mode**

Toggle dark mode on Home. Group avatar colors must shift with the theme. If they stay fixed, a hex leaked through instead of a `var(--color-*)` reference.

- [ ] **Step 5: Verify the edge states**

- Log in as the **unassigned** participant → Home loads normally; the group card shows the "not assigned" state; Ranks shows standings with no "you" marker.
- Log in as a participant with **no** membership → `NoCampScreen`, no bottom nav, no SOS button.
- Set the camp to `status: 'draft'` and reload → `NoCampScreen`.

- [ ] **Step 6: Verify all three languages**

Switch language to UZ and RU on `NoCampScreen` and on the unassigned group card. No English fallback text, no missing-key placeholders.

- [ ] **Step 7: Final gate**

```bash
cd backend && npm run validate
cd ../frontend && npm run validate
```

Expected: PASS in both.

---

## Self-Review Notes

Checked against the spec:

- **Spec coverage.** All spec sections map to tasks: `/me/camps` → Task 1; `/camps/:id/my-group` → Task 2; OpenAPI → Task 3; resolution data layer → Task 4; `NoCampScreen` → Task 5; shell resolution + `CampContext.campId` → Task 6; campHome composer + unassigned group → Task 7; `CURRENT_CAMP_ID` deletion → Task 8; 403 recovery → Task 9; the spec's seven verification points → Task 10.
- **`userId` not `phone`.** Task 1 Step 2 queries by `userId` with the reasoning inline, matching the corrected spec.
- **`toCampGroupDetail` not reused.** Task 2 Step 1 writes a separate `toMyGroup` and states why.
- **Color contract consistent.** Backend returns tokens (Task 2), `paletteColor()` resolves them (Task 7), verified in light and dark (Task 10 Steps 2 and 4).
- **Naming consistent.** `useCampDetail` is used in Tasks 4 and 7; `useCamp` refers only to the outlet context throughout.
- **No TDD steps.** Adapted to `npm run validate` plus manual verification, since neither repo has a test runner and the project preference is explicitly no tests.
- **Known ordering wrinkle.** Task 6 Step 3 intentionally ends on a failing typecheck, resolved by Task 7; the two commit together. This is called out in-task so an implementer doesn't treat it as a mistake.
