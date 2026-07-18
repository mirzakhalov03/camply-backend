# Participant Live Camp Data — Design

**Date:** 2026-07-18
**Surfaces:** backend (`camply-backend`), frontend (`camply-frontend`)
**Status:** approved, ready for planning

## Problem

A logged-in participant sees placeholder content. The camp name, location, dates,
day counter, cover image, and group card all come from `campHomeMock`
(`frontend/src/lib/mocks/mockCamp.ts`), and the schedule, announcements, and
leaderboard screens request `/camps/current/...` — a literal placeholder id that
the backend rejects outright (`campIdParam` is a 24-hex regex).

The participant screens are therefore not "unwired". They are wired to a camp id
that cannot exist. The feature is one missing capability: **the participant has
no way to learn which camp they belong to.**

## What already works

- `schedule.service.ts`, `announcements.service.ts`, and `leaderboard.service.ts`
  issue real axios calls to `/camps/${campId}/...`, matching live backend routes.
- The backend serves those three under `campRouter` with
  `requireAuth + requireCampMember`, so participants are already authorized.
- `toOrganizerCamp` (`backend/src/services/camp.services.ts:47`) already computes
  `name`, `location`, `dateRange`, `coverImage`, and `dayProgress` — nearly the
  exact `CampHome.camp` contract.
- `Membership` is indexed `{ phone: 1, role: 1 }`, which answers "which camps is
  this phone in" without a new index.

## Decisions

| Question | Decision |
|---|---|
| Camps per participant | Server resolves **one active camp**; payload is list-shaped so a switcher is later UI-only work. No switcher in this pass. |
| Camp resolution | **`GET /api/me/camps`** — a member-scoped endpoint. Rejected: a `current` URL alias (breaks cache identity), and embedding memberships in `/auth/me` (bloats every role). |
| Home payload | **Composed client-side** from `GET /camps/:id` + `GET /camps/:id/my-group`. Rejected: a bespoke `/camps/:id/home` aggregate duplicating three existing routes. |
| Group visibility | Own group in full detail; other groups by name/score only via the existing leaderboard. |
| Unassigned participant | Graceful empty state. Camp data still loads. |
| Draft camps | Invisible to participants. Published only. |
| No resolvable camp | Dedicated `NoCampScreen` inside the participant shell. |

## Backend

### `GET /api/me/camps`

New `routes/me.routes.ts` mounted at `/me`. Guard: `requireAuth` only — the route
is self-scoped by definition, so no role gate applies.

Service finds `Membership` rows by the caller's **`userId`** with
`role: 'participant'` and `status: 'active'`, loads the referenced camps, keeps
only those with `status === 'published'`, and sorts by `startsAt` ascending.
Returns an array.

**Query by `userId`, not `phone`.** `requireCampMember` resolves membership with
`MembershipModel.findOne({ campId, userId: user._id })`. If `/me/camps` matched on
phone instead, an unbound row (`userId: null`) could put a camp in the list that
then `403`s on every subsequent camp-scoped call — a camp visible in the UI that
nothing can load. `bindPhone` sets `userId` at login, so a logged-in participant's
rows are always bound.

Projection is a **new `toParticipantCamp`**, not `toOrganizerCamp`. It returns
`id`, `name`, `location`, `dateRange`, `startsAt`, `endsAt`, derived `status`,
`coverImage`, `dayCurrent`, `dayTotal`. It deliberately omits the `...counts`
spread — `campCounts` returns `participantCount`, `organizerCount`, `groupCount`,
and `checkedIn`, none of which belong in a participant response.

Empty array is a valid `200`, not a `404`.

### `GET /api/camps/:id/my-group`

Mounted on the shared-read `campRouter`, guard `requireAuth + requireCampMember`,
router constructed with `Router({ mergeParams: true })` so the middleware can read
`:id`.

Reads `req.membership.groupId`, already resolved by the middleware.

- `groupId === null` → `200 { group: null }`. Unassigned is a valid state.
- otherwise → load the `Group` plus sibling `Membership` rows sharing that
  `groupId`, populate their bound users for names, and return
  `{ id, name, color, photo, memberCount, members: [{ initials, color }] }`.

`members` carries **only** initials and an avatar color — no phones, no user ids,
no full names. This matches the existing `GroupMember` type.

**Do not reuse `toCampGroupDetail`** (`services/group.services.ts:9`). It exists
and looks like a fit, but it returns each member's full `name`, their membership
`id`, and — critically — falls back to `m.phone` as the display name for a member
with no bound user. That is correct for the organizer's roster view and a privacy
leak in the participant's. This endpoint needs its own narrower `toMyGroup`
projection.

**Avatar color contract.** `Group.color` stores a palette **token** (`'pine'`,
`'amber'`, `'sky'`, `'deep'`), and `utils/avatar.ts#colorFor` returns the same
token set. The endpoint returns tokens, not hex. The frontend maps token →
`var(--color-<token>)` before applying it as an inline style. Those variables are
defined in `index.css` and **overridden in dark mode**, so passing the token
through is what keeps group avatars correct in both themes; returning a raw hex
from the server would freeze them to light mode and violate the design-system
guardrail. Note the mock currently uses raw hex (`'#5aa9c4'`) — that is what the
token mapping replaces.

The privacy boundary is structural: `groupId` comes from the caller's own
membership row, so no request parameter can steer this toward another group.

Initials derive from the bound user's `name`/`surname`. Both are optional until
`completeProfile`, so the rule is explicit: first letter of `name` + first letter
of `surname`; if only one is present use its first letter alone; if neither is
present (a claimed participant mid-onboarding) or the membership has no bound
`userId` yet, emit `"?"`. Never fall back to the phone number — that would leak
contact data into a card visible to the whole group.

### Docs

Both endpoints get `registry.registerPath(...)` entries in `docs/openapi.ts`,
reusing their validator schemas, per the backend convention.

## Frontend

### Resolution

- `api/services/me.service.ts` → `meService.camps()`.
- `api/queries/me.queries.ts` → `useMyCamps()`.
- `api/queryKeys.ts` gains a **root-level** `participantKeys.camps =
  ['participant', 'camps']`. It is not a `campKeys.*` key: this is the query that
  determines which camp you are in, so nesting it under a campId would be circular.

`ParticipantDashboard` — the one component wrapping every `/camp/*` route — calls
`useMyCamps()` once and puts the resolved id into the `CampContext` it already
builds:

```ts
export type CampContext = {
  campId: string        // new; always a real ObjectId when a screen renders
  sos: ReturnType<typeof useSos>
  goSchedule: () => void
  // …unchanged
}
```

The shell is the resolution point because it already owns this role; SOS state
established the pattern. A separate store or provider would create a second answer
to "what camp am I in."

### Deletions

`CURRENT_CAMP_ID` is removed. `campId` becomes a **required** parameter on
`useSchedule`, `useAnnouncements`, `useAnnouncement`, `useLeaderboard`,
`useCreateActivity`, `useCreateAnnouncement`, and `scheduleService.list`.

Removing the default is the safety mechanism: a screen that forgets to thread
`campId` becomes a `tsc --noEmit` failure — the project's primary per-change gate —
instead of a silent runtime 400.

### `lib/campHome.ts`

Becomes a composer. `useCampHome(campId)` combines `useCampDetail(campId)`
(`GET /camps/:id`) and `useMyGroup(campId)`, assembling the existing `CampHome`
type. The type and every consumer — `HomeScreen`, `CampCover`, `MyGroupCard` —
are unchanged. `mockCamp.ts` is no longer imported.

**Naming:** the new detail hook is `useCampDetail`, **not** `useCamp` —
`campContext.ts` already exports `useCamp()` for the outlet context, and two hooks
named `useCamp` in one folder is a real collision.

`unreadChat` is **not** server-sourced. Chat remains client-side, so that field
continues to read `useChatStore` rather than being faked into an API payload.

### Screens and states

`ParticipantDashboard` renders three ways:

1. `useMyCamps()` pending → skeleton chrome.
2. resolved to empty → `NoCampScreen`; bottom nav and SOS button hidden, since
   there is no camp to signal to.
3. otherwise → `<Outlet context={ctx}>` with a guaranteed `campId`.

Because the shell does not render `<Outlet>` until resolution succeeds, no screen
needs a "what if there is no camp" branch.

`NoCampScreen` is a new component, not reused `ComingSoon` — that component means
"feature not built", which would misdescribe this state. Its strings are added to
`i18n/translations.ts` in EN/UZ/RU; the type there makes a missing translation a
compile error.

`ScheduleScreen`, `AnnouncementsScreen`, `RanksScreen`, `ProfileScreen`, and
`HomeScreen` each pull `campId` from `useCamp()` and pass it to their existing
hook. Their loading, error, and empty branches are untouched.

`MyGroupCard` gains an unassigned branch for `group: null`.

`RanksScreen` needs no change: `leaderboardService` already returns
`currentGroupId: string | null` and `deriveLeaderboard` handles null.

### Error handling

A `403` from a camp-scoped endpoint means membership changed underneath the user —
removed from the camp, or the camp was archived. That invalidates
`participantKeys.camps` and re-resolves, landing them on `NoCampScreen` rather
than a stuck error state.

## Out of scope

- Camp switching UI (the endpoint is list-shaped; the picker is later work).
- Server-owned chat unread state.
- Participant-visible group browsing beyond names/scores on the leaderboard.
- The cross-camp participant portal (post-launch per root `CLAUDE.md`).

## Verification

No test runner is configured (project preference). Verify manually:

1. Seed a published camp with groups and a participant phone on the roster.
2. Log in as that participant → home shows the real camp name, location, date
   range, and day counter.
3. Schedule, announcements, and ranks screens load that camp's real data.
4. A participant with no membership sees `NoCampScreen`.
5. A participant on a **draft** camp also sees `NoCampScreen`.
6. A rostered participant with no group sees the unassigned `MyGroupCard` state
   while the rest of the camp data loads normally.
7. `npm run validate` passes in both repos.

## Notes

This spec spans both repos. Root `docs/` is not a git repository (frontend and
backend are separate ones), so this file is not committed from here.
