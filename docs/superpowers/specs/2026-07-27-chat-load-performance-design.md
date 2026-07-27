# Chat Load Performance — Waterfall, N+1 & Skeletons — Design

**Date:** 2026-07-27
**Surfaces:** backend (`camply-backend`), frontend (`camply-frontend`)
**Status:** approved, ready for planning
**Builds on:** `2026-07-21-realtime-chat-design.md`, `2026-07-23-chat-reactions-receipts-push-design.md`
**Paired with:** `2026-07-27-chat-offline-outbox-design.md` (offline + queued sends — ships after this)

## Problem

Chat feels slow and sluggish to open, and it frequently shows a "can't load"
screen when nothing has actually failed. Investigation found five distinct
causes — one is a rendering bug, three are avoidable latency, one is a liveness
gap:

1. **The "can't load" screen is a bug, not a failure.** `ChatScreen.tsx:30` calls
   `useChat(campId, groupId)`, which is `enabled: Boolean(groupId)`
   (`chat.queries.ts:13`). While `useMyGroup` is still in flight `groupId` is
   `''`, so the query is **disabled** → `isPending: true`, `isFetching: false`,
   therefore **`isLoading` is `false`**. Control falls past the loading branch to
   `if (isError || !data)` (line 86) and renders `t.chat.loadError`. Every cold
   open flashes an error. `OrgChatScreen` avoided it by branching on `isPending`.

2. **A three-hop request waterfall.** `useCamp()` → `useMyGroup(campId)` →
   `useChat(campId, groupId)`, strictly serial. The third hop is
   **unnecessary**: `GET /camps/:id/chat/group/messages` derives the room from
   `req.membership` and *returns* `groupId` in its payload. The client never
   needed to know the group first — the `enabled` gate encodes a client-side
   assumption the server already contradicts.

3. **A sequential N+1 on the server.** `chat.services.ts:80-98` (`membersFrom`)
   runs `await UserModel.findById(...)` **inside a `for` loop** — one round-trip
   per member. A 30-person group is 30 serial round-trips; the organizers channel
   can be 100. This is the dominant server-side cost of a history load.

4. **The history payload's three parts are serial.** `listGroupHistory` /
   `listOrganizersHistory` await `members`, then `messages`, then
   `othersLastReadAt`. Object-literal properties evaluate in order, so three
   independent queries run back-to-back instead of together.

5. **Reconnect never backfills.** `connectRealtime`'s `connect` handler re-joins
   the room on every reconnect but does not refetch history. Messages sent while
   the socket was down are silently missing until a full remount — a correctness
   bug on the weak networks camps actually run on.

There is also **no loading skeleton** for either chat screen, the only two
screens in the app still missing one (`ScheduleSkeleton`, `RanksSkeleton`,
`HomeSkeleton`, `AnnouncementsSkeleton`, `CampsSkeleton` all exist).
ReadyProduct §9 asks for a loading state on every screen.

## What already works (do not rebuild)

- The Socket.IO transport, room derivation, entitlement checks, and the
  `chat:message` / `chat:reaction` / `chat:read` / `chat:unread` events.
- `chatService` as the single projection shared by REST and sockets.
- The realtime→React-Query bridge (`realtimeBridge.ts`) and its dedupe-by-id
  `appendMessage`.
- Reactions, read receipts, the unread badge, and push. All server-real as of
  2026-07-23. **This spec changes none of their semantics.**

## Decisions

- **`isPending`, never `isLoading`, for any conditionally-enabled query.** A
  disabled query is pending-but-not-fetching forever, so `isLoading` never goes
  true. `isError` becomes the *only* error signal; a bare `!data` must never
  render an error.
- **The group-chat query key loses its `groupId` segment.** It becomes
  `campKeys.chat(campId)` — read as *"my group room in this camp."* This is
  correct on both surfaces: the organizer's coordinator chat is the same
  server-derived room from the same endpoint. A user is only ever joined to one
  group room per camp, so a single key cannot collide.
- **`useChat` takes an explicit `enabled` option** instead of inferring one from
  `groupId`. The participant screen passes nothing (fires immediately, in
  parallel with `useMyGroup`); `OrgChatScreen` passes `enabled: isCoordinator` so
  non-coordinator organizers don't issue a request they'd discard.
- **Batch, don't loop.** `membersFrom` does one `$in` query plus an in-memory
  Map. Any future member projection follows the same rule.
- **`.lean()` everywhere in chat reads.** Every chat query is projected to a DTO
  immediately, so Mongoose document hydration is pure overhead.
- **Reconnect invalidates chat history.** The same `connect` handler that
  re-joins rooms also invalidates the chat queries, so a dropped connection
  self-heals its *content*, not just its membership.

## Architecture

### Backend (`camply-backend`)

**`src/services/chat.services.ts`** — the only file that changes.

- `membersFrom(memberships)` — replace the loop with a single
  `UserModel.find({ _id: { $in: ids } }).select('name surname photo').lean()`,
  build a `Map<string, user>`, then project. Same output shape, same
  `initialsOf`/`colorFor` treatment, same ordering as the input memberships.
  Unbound memberships (`userId == null`) are filtered out exactly as today; a
  bound membership whose user row is missing degrades to an empty name, as today.
- `history(...)` — add `.lean()`. `toChatMessage` already reads only plain
  fields plus `createdAt`, so it is unaffected; type it against a lean shape.
- `groupMembers` / `organizerMembers` — add `.lean()` to the `MembershipModel`
  queries.
- `listGroupHistory` / `listOrganizersHistory` — wrap the three independent
  awaits in a single `Promise.all`, then assemble the object.

No route, validator, model, or OpenAPI change. The response contract is
byte-identical — this is pure latency work.

### Frontend (`camply-frontend`)

**`src/api/queryKeys.ts`** — `chat: (campId: string)` drops its `groupId`
parameter; the doc comment says "my group room in this camp."

**`src/api/queries/chat.queries.ts`** — `useChat(campId, options?)` where
`options` is `{ enabled?: boolean }`, defaulting to `true`. The query stays
gated on `Boolean(campId)` and now ANDs in the caller's flag.

**`src/components/participant/chat/ChatScreen.tsx`**
- `useChat(campId)` — no `groupId` argument, fires in parallel with
  `useMyGroup`.
- `if (isPending) return <ChatSkeleton />`
- `if (isError) return <error>` — `!data` is no longer an error condition.
- After the guards, `data` is defined. `groupId` for sends comes from
  `data.groupId ?? ''` (server truth) rather than `myGroup?.id`.
- **New distinct state:** `data.groupId === null` means the participant is not
  assigned to a group. Previously the `enabled` gate meant these users saw the
  error screen forever; now they must see a purpose-built "you're not in a group
  yet" message, not the generic empty-thread copy. New i18n key
  `chat.noGroupYet` in EN/UZ/RU.

**`src/components/organizer/chat/OrgChatScreen.tsx`**
- `useChat(campId, { enabled: isCoordinator })`.
- Keep its existing `isPending` branch; swap the `…` placeholder for
  `<ChatSkeleton />`.

**`src/store/useChatStore.ts`** — `toggleReaction` drops its now-unused `groupId`
parameter; the key is chosen by `channel` alone. `MessageList`'s `groupId` prop
goes with it.

**`src/api/realtime/realtimeBridge.ts`**
- `keyFor(channel, _groupId)` returns `campKeys.chat(currentCampId)` for
  `'group'`. The event's `groupId` is still used for the **unread room key**
  (`roomKey`), which is intentionally per-room and unchanged.
- The `connect` handler, after `chat:connectCamp`, invalidates
  `campKeys.chat(campId)` and `campKeys.chatOrganizers(campId)`. On the very
  first connect this is a cheap no-op-ish revalidation; on a reconnect it is the
  backfill. Guard it so the first connect does not double-fetch alongside the
  screen's own mount fetch — invalidate only when the socket reports a
  *reconnect* (track a `hasConnectedOnce` flag in the module).

**`src/components/participant/chat/ChatSkeleton.tsx`** (new) — composed from the
`Skeleton` primitive, mirroring `MessageList`'s real layout so there is no jump
on swap: a header strip (avatar circle + two text lines), then six bubbles
alternating left/right at varied widths (`w-2/3`, `w-1/2`, `w-3/4`, …) with the
same `gap-2.5 p-3.5` rhythm, then a composer bar. Shared by both chat screens;
lives beside the participant chat components and is imported by the organizer
screen, matching how `GroupPhotoButton` is already shared.

## Non-goals

- **No message pagination / infinite scroll.** The backend serves the latest 50
  and that stays. `Frontend/CLAUDE.md` is explicit: Camply is *"real-time /
  freshness / offline heavy — NOT volume heavy"* and *"don't build volume infra
  (virtualization, heavy pagination) unscoped."* Camp chat is "what's happening
  now" for a ~30-person group over a two-week camp. Scrollback beyond 50 is a
  post-launch decision, recorded here so it is a choice and not an oversight.
- **No list virtualization.** Same reasoning; 50–200 bubbles do not need it.
- **No caching, persistence, or offline behavior.** That is the paired spec.
- **No change to reactions, read receipts, unread, or push semantics.**
- **No presence work.** `onlineCount: 0` stays a known placeholder.

## Risks

- **Query-key change has three call sites** (`chat.queries.ts`,
  `useChatStore.ts`, `realtimeBridge.ts`). Missing one produces a silently
  split cache: messages append to a key nothing reads, and the thread looks
  frozen. The verification step below explicitly covers a live send.
- **Dropping the `groupId` gate means unassigned participants now issue a
  request** that returns an empty payload. This is correct and cheap, but it
  changes what they see from an error screen to the new `chat.noGroupYet` state
  — confirm that copy exists in all three languages before shipping.
- **`.lean()` changes the runtime type** from a Mongoose document to a plain
  object. `toChatMessage` casts `createdAt` off the document today; that cast
  must be re-pointed at the lean type or TypeScript will pass while the shape is
  wrong. `npm run typecheck` in the backend is the gate.
- **Reconnect invalidation could thrash** on a flapping connection. Gate on
  "this is a reconnect, not the first connect"; React Query's own dedupe absorbs
  the rest.

## Verification

No test runner exists in either repo (project preference). Verification is
`npm run validate` in each repo plus these manual checks:

1. **Phantom error gone:** hard-reload the participant Chat tab on a throttled
   connection (DevTools → Slow 3G). A skeleton must appear — never
   `t.chat.loadError`.
2. **Waterfall gone:** DevTools → Network, filter XHR. `my-group` and
   `chat/group/messages` must start at the same time, not one after the other.
3. **N+1 gone:** time `GET /camps/:id/chat/organizers/messages` on the demo seed
   (`npm run seed:demo` gives 10 organizers, 100 participants) before and after.
   Record both numbers in the PR.
4. **Live send still works:** two browsers, two participants in one group. A
   send in A appears in B with no refresh. This proves the key change landed in
   all three call sites.
5. **Reactions + ticks still work:** tap a reaction, confirm it persists across a
   reload; confirm `✓✓` still resolves.
6. **Reconnect backfill:** with two sessions open, kill B's network (DevTools →
   Offline), send two messages from A, restore B's network. B must show both
   without a refresh.
7. **Unassigned participant:** a participant with no group sees
   `chat.noGroupYet`, not an error and not a blank thread.
8. **Organizer screen:** a non-coordinator organizer issues **no**
   `chat/group/messages` request; a coordinator does and sees their group thread.

## Ship order

1. Backend `chat.services.ts` (N+1, `Promise.all`, `.lean()`) — independent,
   shippable alone, zero contract change.
2. Frontend query-key + `useChat` signature + all three call sites, together in
   one change (they cannot be split without breaking the cache).
3. `ChatSkeleton` + the `isPending`/`isError` branches + `chat.noGroupYet` i18n.
4. Reconnect invalidation.
5. Update `Frontend/CLAUDE.md` and `Backend/CLAUDE.md` in the same effort.
