# Realtime Chat — Design

**Date:** 2026-07-21
**Surfaces:** backend (`camply-backend`), frontend (`camply-frontend`)
**Status:** approved, ready for planning

## Problem

Chat is fully built on the frontend and fully absent on the backend.

- The participant **group chat** (`/camp/chat`) and the organizer **two-channel
  chat** (`/org/chat`, `organizers` + coordinator-gated `group`) both exist as
  polished UI running on mock data (`lib/chat.ts`, `orgChat.service.ts`) plus a
  session-local Zustand store (`useChatStore`/`useOrgChatStore`) that fakes
  sending, delivery, and read receipts. Nothing survives a reload.
- The backend has no `Message` model, no chat routes, and no WebSocket layer at
  all. The only trace is `camp.services.ts:367`'s `unreadChat: 0 // realtime
  chat is out of scope`.
- `realtimeBridge.ts` already anticipates this: a `chat:message` event type and
  the cache-append logic (`setQueryData(campKeys.chat(campId, groupId), ...)`)
  are coded, but `connectRealtime(campId)` is never called.
- **A real gap, not just a wiring gap:** "the group a coordinator chats with" has
  no backend home today. It exists only as `User.subRole` (camp-agnostic,
  explicitly "stored, not yet enforced") and as `useOrganizerStore.group`, an
  in-memory, never-persisted onboarding value. This spec has to give it a real
  home, or the coordinator half of the feature has nothing to key off.

**Goal:** persist chat messages, deliver them live over Socket.IO, and give a
coordinator's group assignment a real backend home — with no UI rewrite on the
frontend, just the mock → real seam flip both `lib/chat.ts` and
`orgChat.service.ts` already exist to make.

## Decisions

| Question | Decision |
|---|---|
| Transport | **Socket.IO** (explicit product preference). REST is used only for initial history load; sending and receiving both happen over the socket. |
| Message content | **Text only.** No attachments, reactions, read receipts, typing indicators, or edit/delete server-side. Matches the original frontend design's YAGNI list — none of that is being retrofitted now. |
| Reactions / read receipts already in the mock UI | **Left alone, stay client-only.** They're cosmetic, ephemeral, and don't touch the server. This spec does not remove or persist them — just don't confuse them with real message delivery. |
| Attachments (image/file) already in the mock UI | **Hidden for v1.** No upload pipeline exists (same "separate concern" carve-out as camp cover images). Sending one would silently do nothing against a real backend, which is worse than not offering it. |
| Two organizer channels vs. one | **`organizers`** is a camp-wide room, all organizer-tier memberships (manager + every sub-role), never participant-visible. **`group`** is *not* a separate parallel channel — it is the **same room** as the participant group chat for that group. A coordinator opening `/org/chat`'s group tab and a participant opening `/camp/chat` for the same group see and post to the identical conversation. |
| Coordinator group assignment | **Reuse `Membership.groupId`**, restricted to rows where `role === 'coordinator'`. The field already exists and is already the join key for room membership — this makes "one group" a structural property (a single field, not an array) rather than a rule to enforce. Needs two small write paths that don't exist today (see below). |
| Message history pagination | **Latest 50, no older-message paging.** Matches "simple for now"; infinite scroll is future work, same as the original frontend design deferred it. |
| Presence (`online` field the UI already renders) | **In-memory per-room socket presence**, tracked by the socket layer itself (no DB write). Single-process only — acceptable at current scale, called out as a risk below. |

## Backend

### Data model — `Message`

```
Message {
  campId:    ObjectId<Camp>,
  channel:   'group' | 'organizers',
  groupId:   ObjectId<Group> | null,   // required + non-null iff channel === 'group'
  authorId:  ObjectId<User>,
  text:      String,                    // 1..2000 chars, trimmed
  timestamps
}
```

- Index `{ campId, channel, groupId, createdAt }` — the query shape for history
  load is always "latest N for this exact room."
- No `kind` field. Text-only means there's nothing to discriminate yet; adding
  it later when attachments land is additive, not a migration.
- Author display data (name, initials, color) is **not** denormalized onto the
  message — same pattern as everywhere else in this codebase
  (`toAnnouncement`'s author join). The frontend's `ChatMessage` type already
  only carries `authorId`; it resolves the author against the room's
  `members[]` list, which the history/bootstrap payload supplies.

### Coordinator group assignment (prerequisite work)

Two small additions to the existing `organizer.services.ts`/`team.services.ts`
domain — this is what gives "the group a coordinator is assigned to" a real
backend answer:

1. **`POST /organizer/team/invites`** (team invite) gains an optional
   `groupId` in the body. Validator (`team.validators.ts`) rejects it unless
   `role === 'coordinator'`, and resolves it against the caller's own camp
   (same group-ref resolution `campService.createFull` already does for batch
   groups) — a coordinator can't be pointed at another camp's group.
2. **`PATCH /organizer/team/:membershipId/group`** (new, `requireCampManager`)
   — `{ groupId: string | null }`, for reassigning or clearing a coordinator's
   group after the fact (coordinator handoff, group dissolved). 400s if the
   target membership's `role !== 'coordinator'`.

`Membership.groupId`'s doc comment gets updated to state the dual meaning
explicitly: for a `participant` row, the group they belong to; for a
`coordinator` row, the single group they chat with; null means unassigned in
both cases. No schema change — same field, same index, just a widened and
documented meaning.

### Room membership (who's in which room — server-derived, never client-asserted)

- **`group:{campId}:{groupId}`** — every `Membership` row (any role) in that
  camp with that `groupId`. Participants land here via the existing
  roster-add path; coordinators via the two paths above.
- **`organizers:{campId}`** — every organizer-tier `Membership` row in that
  camp (any of the 7 sub-roles) plus the org super-admin. Participants never
  join this room under any condition.

On socket connect, the server loads the caller's memberships for the camp
they're connecting to and joins them to the rooms they're entitled to — the
client never names a room. This is the same "server is the sole authority"
posture as `requireCampManager`/the hidden-button guardrail: a participant
socket cannot request the `organizers` room and get it.

### REST — history bootstrap only

| M | Path | Guard | |
|---|---|---|---|
| GET | `/camps/:id/chat/group/messages` | `requireAuth + requireCampMember` | Uses `req.membership.groupId` — **no groupId in the URL**, same structural-privacy pattern as `/camps/:id/my-group`. Unassigned → `200 { groupId: null, members: [], messages: [] }`, not a 403 — unassigned is a valid state, matching the existing convention. Also returns the room's `members[]` (participants + any coordinator) for the frontend's author-lookup contract. |
| GET | `/camps/:id/chat/organizers/messages` | `requireAuth + requireCampManager` | Organizer-tier only; a participant gets `403`. Returns `members[]` = every organizer-tier membership in the camp. |

Both mounted on the shared `campRouter` (`Router({ mergeParams: true })`,
per the existing `:id`-reading requirement), alongside schedule/announcements/
leaderboard.

### Socket.IO layer

New `sockets/` directory, attached to the same HTTP server `app.listen` already
creates (Socket.IO needs the raw server, not just the Express app).

**Auth on handshake.** No bearer token exists in this app — sessions are the
httpOnly `camply_sid` cookie. The socket handshake carries cookies
automatically for same-origin/`withCredentials` connections; the connection
middleware parses `camply_sid`, does the identical sha256-lookup
`requireAuth` does against the `sessions` collection, and rejects the
handshake (not just the room join) if the session is missing, expired, or
`active === false` — mirroring `requireAuth`'s own checks so a deactivated
account can't hold a live socket any more than it can hold a live session.

**Events:**

| Direction | Event | Payload | |
|---|---|---|---|
| C→S | `chat:connectCamp` | `{ campId }` | Joins the caller into every room they're entitled to for that camp, per the derivation above. Sent once after connecting, when the frontend knows which camp it's in. |
| C→S | `chat:send` | `{ campId, channel, text }` | Server re-derives `groupId` from `req.membership` (channel `'group'`) — **never** trusts a client-sent `groupId`. Validates `text` with the same Zod schema the REST layer would use (constructed once, called manually here since the socket layer bypasses the `validate(...)` middleware). Persists via `chatService.postMessage(...)`, then emits `chat:message` to the room. Rejects (channel `'group'` + unassigned, or channel `'organizers'` + participant caller) with a `chat:error` ack, not a silent drop. |
| S→C | `chat:message` | `{ channel, groupId, message: ChatMessage }` | Broadcast to the room. This is the exact shape `realtimeBridge.ts`'s stub `handleEvent` already expects — no change needed there. |
| S→C | `chat:presence` | `{ channel, groupId, onlineUserIds: string[] }` | Broadcast to a room on join/leave, driven by in-memory socket-count-per-room bookkeeping (see risk below). |
| S→C | `chat:error` | `{ code, message }` | Ack-style rejection for a `chat:send` that fails validation/authorization. |

`chatService` is the one place both the REST history route and the socket
`chat:send` handler call into — same layering rule as everywhere else
(`routes/sockets → controllers/handlers → services → models`), so there's a
single source of truth for "what counts as a valid message in this room,"
not two.

### Docs

`registry.registerPath(...)` entries for both REST routes in `docs/openapi.ts`.
Socket events aren't OpenAPI's concern; document the event contract in this
spec and carry it into the implementation plan instead.

## Frontend

### Data contract migration

Per the standing "lib/ is the mock-era transitional zone" rule, this endpoint
landing means `lib/chat.ts` migrates into `api/services/chat.service.ts` +
`api/queries/chat.queries.ts`, same as every other domain that's gone live.
`orgChat.service.ts`/`orgChat.queries.ts` already live under `api/` — they get
their mock branch deleted, not moved.

- `useChat(campId, groupId)` replaces the parameterless `useChat()`, keyed by
  the **already-registered** `campKeys.chat(campId, groupId)` — fixing the
  existing drift where the mock-era hook used an inline `['groupChat']` key
  instead of the registry.
- `useOrgChat(campId)` (organizers channel) gets a new key,
  `organizerKeys.orgChatOrganizers(campId)`.
- The coordinator's **group** tab in `OrgChatScreen` calls the *same*
  `useChat(campId, groupId)` as the participant screen — same cache entry,
  same room, because it's the same conversation. No new key needed for it.

### Realtime bridge

`realtimeBridge.ts`'s `connectRealtime(campId)` finally gets called:

- Participant side: from `ParticipantDashboard`, once `useMyCamps()` resolves
  `campId` (the same point that already seeds `CampContext`).
- Organizer side: from wherever the organizer's active camp resolves in
  `OrganizerShell` — this spec assumes that resolution point exists or is
  trivial to add; confirm exact wiring in the implementation plan.

On connect, the bridge emits `chat:connectCamp`. Incoming `chat:message`
writes into `campKeys.chat(campId, groupId)` (group room) or
`organizerKeys.orgChatOrganizers(campId)` (organizers room) via `setQueryData`
— exactly the append logic already written in the stub, just now fed by a
real event instead of never firing.

### Coordinator gating — from onboarding-time to server-known

`OrgChatScreen`'s `isCoordinator` check currently reads
`useOrganizerStore.role`, an unpersisted onboarding value. That's replaced by
a real, per-camp, server-sourced fact: a new lightweight endpoint
(`GET /organizer/camps/:id/my-role` or a field added to the existing organizer
camp-detail projection — pick one in the implementation plan) returning
`{ role, groupId }` for the caller's own membership in that camp. The lock
panel gates on `role === 'coordinator'`; the unlocked group tab uses the
returned `groupId` to call `useChat(campId, groupId)`.

`useOrganizerStore.group` stops being read for this purpose — it remains
whatever it already is for onboarding, but is no longer the source of truth
for "which group does this organizer chat with."

### Sending

`useChatStore`'s `sendText` stops writing a fully-local `sent[]` array as the
message's only home. It becomes an **optimistic append**: show the message
immediately, emit `chat:send` over the socket, and reconcile when the
server's `chat:message` echo arrives (same reconciliation the original 2026-
07-07 design already anticipated: *"the optimistic message reconciles with
the server echo"*). `sendAttachment` is removed from the send path per the
attachments-hidden decision above; the composer's `+` button is hidden rather
than left wired to nothing.

### i18n / design system

No new copy beyond whatever the coordinator lock-panel / error states need —
existing `chat` translation block covers the rest. No new tokens.

## Out of scope

- Attachments (image/file messages), reactions, read receipts, typing
  indicators, edit/delete — unchanged from the original frontend-only design's
  YAGNI list.
- Older-message pagination / infinite scroll.
- Horizontally-scaled Socket.IO (a Redis adapter for multi-process presence/
  broadcast) — single Node process is assumed, matching current deploy scale.
- Granular per-sub-role chat permissions beyond "organizer-tier vs.
  participant vs. coordinator-with-a-group" — same captured-not-enforced
  posture as the rest of `Membership.role`.
- Push notifications for new messages (separate from the existing unrelated
  push-notification feature for announcements/SOS).

## Risks & gotchas

- **Dev proxy needs WebSocket upgrade.** Vite's `/api` proxy
  (`vite.config.ts`) currently proxies HTTP only; Socket.IO's handshake
  upgrades the connection, so the proxy config needs `ws: true` for whatever
  path Socket.IO is mounted on, or the socket simply won't connect in dev.
  Flag this explicitly in the implementation plan — it's the kind of thing
  that works in a curl-tested REST endpoint and silently fails only in the
  browser.
- **Cross-origin cookies in prod** (already a documented backend caveat) apply
  identically to the socket handshake — if the API ever moves off the
  same-origin dev proxy, the `SameSite=None; Secure` + CORS `origin` change
  needs to cover the Socket.IO server too, not just Express routes.
- **In-memory presence resets on restart/redeploy** and doesn't work correctly
  behind more than one Node process. Acceptable now; revisit alongside any
  horizontal-scaling decision.
- **Coordinator handoff race**: `PATCH .../group` changes room membership for
  future messages/connections immediately, but an already-connected socket
  isn't forcibly re-joined/left until it reconnects. Minor; note it, don't
  necessarily solve it in the first pass.

## Verification

No test runner (project preference). Manual, per both repos' CLAUDE.md:

1. `npm run typecheck` in `camply-backend` after adding the model/routes/
   sockets; `npm run validate` in `camply-frontend` after the wiring changes.
2. Seed a published camp with a group and two participant phones in it
   (`npm run seed:demo`). Log in as both in two browser sessions; messages
   sent by one appear live for the other without a refresh.
3. Invite an organizer with `role: 'coordinator'` and a `groupId` targeting
   that same group; confirm their `/org/chat` group tab shows the identical
   thread the participants see, and that they can post into it.
4. A non-coordinator organizer sees the lock panel; a participant hitting the
   organizers-channel REST route directly gets `403`.
5. Restart the backend process mid-session; sockets reconnect and history
   reload produces the same last-50 messages (nothing was lost — messages are
   persisted, only presence resets).

## Notes

This spec spans both repos; each keeps its own copy under
`docs/superpowers/specs/`, per the existing cross-repo convention (see the
2026-07-18 participant-live-camp-data spec). It supersedes the "frontend-only"
framing of the 2026-07-07 participant-group-chat design now that a real
backend is in scope — that doc's UI/UX decisions (bubbles, member sheets,
pinned bar) stand; its "out of scope, YAGNI" list and its assumption that
`useChatStore` is the permanent home for sent messages do not.
