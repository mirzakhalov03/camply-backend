# Chat Liveness — Reactions, Read Receipts, Unread & Push — Design

**Date:** 2026-07-23
**Surfaces:** backend (`camply-backend`), frontend (`camply-frontend`)
**Status:** approved, ready for planning
**Builds on:** `2026-07-21-realtime-chat-design.md` (the Socket.IO chat that shipped).
**Reconciles / partially supersedes:** the root `docs/superpowers/specs/2026-07-20-realtime-delivery-design.md`
(approved, never built) — see *Relationship to prior specs*.

## Problem

The chat that shipped (2026-07-21/22, Socket.IO) delivers plain text and nothing
else. Four gaps remain, and three of them are *finished-looking UI with no data
behind it*:

1. **Reactions are fake.** `useChatStore.reactionOverrides` is a per-device,
   per-session overlay — never sent to the server, never seen by anyone else, gone
   on refresh.
2. **Read receipts are unbuilt.** `MessageBubble` renders `✓`/`✓✓` from
   `message.status`, but nothing ever *sets* `status`. There is no read tracking
   server-side.
3. **New-message notifications don't exist.** The Chat-tab badge reads a mock
   `home.unreadChat`. There is no live unread count and no OS-level push — the
   backend push sender was never built (only the frontend half exists).
4. **Live delivery is unreliable — "needs a refresh."** New messages from others
   sometimes don't appear until the thread is reloaded. The wiring *reads* correct,
   so this is a runtime bug to reproduce and instrument, not guess at.

These are one concern: making the chat *live and social* on the transport that
already exists.

## What already works (do not rebuild)

- **Socket.IO transport** end-to-end: handshake auth over the `camply_sid` cookie
  (`sockets/auth.ts`), server-derived rooms `group:{campId}:{groupId}` and
  `organizers:{campId}` (`sockets/chat.handlers.ts`, `chat:connectCamp`),
  `chat:send` → persist → broadcast `chat:message`. The frontend `realtimeBridge`
  is the single socket, writing into the React Query cache.
- **`chatService`** (`services/chat.services.ts`) is the single projection source
  for REST history + socket sends. `toChatMessage`, `history`, room-member
  projections all live here.
- **The entire frontend push path:** `sw.ts` (push + notificationclick handlers),
  `vite-plugin-pwa` in `injectManifest` mode, `hooks/pushClient.ts`,
  `usePushNotifications.ts`, the Profile toggle, `pushsubscriptionchange`
  re-subscription. Only `api/services/push.service.ts` still has its two axios
  calls commented out.

## Frozen push contract (honored exactly, from the 2026-07-20 spec + shipped FE)

```
POST   /api/push/subscribe   { subscription: PushSubscriptionJSON }  → 201  (idempotent upsert on endpoint)
DELETE /api/push/subscribe   { endpoint: string }                    → 204

Env:  VITE_VAPID_PUBLIC_KEY  (frontend, public)
      VAPID_PRIVATE_KEY      (backend only)
      VAPID_SUBJECT          (backend only, e.g. mailto:ops@camply)
      — all OPTIONAL in the zod schema; the sender no-ops with a warning when unset,
        so boot never breaks before keys are generated.

SW push payload:  { title, body, url, tag? }   (deep-link via `url`; notificationclick reads data.url)
```

## Hard constraint (from the prior spec, still true)

**Language is client-only.** `i18n/useLanguageStore.ts` never reaches the server and
`user.model.ts` has no language field, so the server cannot render a push in the
recipient's language — a trilingual-guardrail violation the moment push goes live.
Fixing this is in scope: add `User.language`, synced via the existing `PATCH /auth/me`.

## Decisions

| Question | Decision |
|---|---|
| Transport | **Socket.IO** (already live). The 2026-07-20 raw-`ws` `/ws` transport is dropped — superseded. |
| Reaction storage | **Embedded** on the `Message` doc (`reactions: [{ userId, emoji }]`). Bounded per message; fits the "not volume-heavy" philosophy. No separate collection. |
| Reaction broadcast | Broadcast **counts only** (`{ emoji, count }[]`) — no reactor identities on the wire. Each client **owns its own `mine`** (seeded per-viewer from REST history, toggled locally on its own action). Privacy-preserving and correct. |
| Read-receipt semantics | **"Seen by anyone."** `✓` = stored; `✓✓` (blue) = at least one *other* member has read past this message. |
| Read tracking | One `lastReadAt` per member per room (`ChatRead` collection). A message I sent is `read` when `max(othersLastReadAt) ≥ message.createdAt`. No per-message fan-out. |
| Unread source | Live client store, seeded by a `chat:unread` event on connect (server counts messages after my `lastReadAt`), incremented by `chat:message` for a room I'm not viewing, cleared on open (which also emits `chat:read`). |
| Push dispatcher | A single `notify.service.ts` is the only push fan-out. Chat resolves its own room audience and calls it; announcements/schedule/leaderboard plug into the same service later. |
| Push presence | "Skip currently-connected users" uses **Socket.IO `fetchSockets()`** on the room — no separate presence subsystem. |
| Push language | `notify.service` renders title/body from a small server map `src/i18n/notifications.ts` using each recipient's `User.language` (default `'uz'`). |
| Push audience (chat) | Room members **minus the author minus everyone currently in that room's socket**. Dead subscriptions self-prune on `410`/`404`. |
| Camp-hours gating | Chat push is **not** camp-hours gated (chat is not location; only participant location is hours-scoped). |
| Delivery guarantee | Best-effort. Socket is a cache nudge; every message is refetchable over REST, so a dropped frame costs a stale view, never lost data. |

## Architecture

```
 chat.handlers.ts (Socket.IO)
   chat:send      → chatService.postMessage → broadcast chat:message → notify.chatMessage(...)
   chat:react     → chatService.toggleReaction → broadcast chat:reaction (counts)
   chat:read      → chatReadService.mark → broadcast chat:read
   chat:connectCamp → also emit chat:unread (seed) to the joiner
                              │
                    notify.service.ts ── push/sender.ts (web-push) ── PushSubscription
                       (audience = room members − author − connected)
```

### Backend

**1 · Reactions**
- `message.model.ts`: add `reactions: [{ userId: ObjectId ref User, emoji: String }]`
  (`_id: false`). A user may add several *distinct* emojis to one message;
  uniqueness is per `{userId, emoji}` pair, and toggling an existing pair removes it.
- `chatService.toChatMessage(doc, viewerId)`: aggregate `reactions` → `{ emoji,
  count, mine }[]` where `mine = reactors(emoji).includes(viewerId)`. **Signature
  gains `viewerId`** — every history/send projection now passes the requester.
- `chatService.toggleReaction({ messageId, userId, emoji })`: atomic add/remove of
  the `{userId, emoji}` pair; returns the message's `{ emoji, count }[]` aggregate.
- `chat:react { campId, channel, messageId, emoji }`: re-derive entitlement (same
  room-membership check `chat:send` uses), toggle, broadcast `chat:reaction {
  channel, groupId, messageId, reactions: {emoji,count}[] }` to the room.

**2 · Read receipts**
- `models/chatRead.model.ts`: `{ campId, channel, groupId|null, userId, lastReadAt }`,
  unique compound `{ campId, channel, groupId, userId }`.
- `services/chatRead.services.ts`: `mark({campId, channel, groupId, userId})` upserts
  `lastReadAt = now`; `othersLastReadAt(room, exceptUserId)` → max over other members;
  `unreadCounts(userId, rooms)` → messages after each room's `lastReadAt`.
- `chat:read { campId, channel }`: validate entitlement, `mark`, broadcast
  `chat:read { channel, groupId, userId, lastReadAt }` to the room.
- REST history payloads gain `othersLastReadAt: string | null` (max `lastReadAt`
  among members other than the requester) to seed the ticks on load.

**3 · Unread**
- On `chat:connectCamp`, after joining rooms, emit `chat:unread { rooms: [{ channel,
  groupId, count }] }` to that socket only (via `chatRead.unreadCounts`).

**4 · Push (the frozen contract)**
- `models/pushSubscription.model.ts`: `{ userId, endpoint (unique), keys: { p256dh,
  auth }, userAgent?, createdAt }`, indexed on `userId`.
- `routes/push.routes.ts` + controller + validator: the pinned `POST`/`DELETE`.
  `POST` upserts on `endpoint` (idempotent — the SW re-posts after
  `pushsubscriptionchange`).
- `services/push/sender.ts`: wraps `web-push` with the VAPID env; on `410`/`404`
  delete that subscription row. No-ops with a warning if VAPID env is unset.
- `services/notify.service.ts`: the single fan-out. Exposes `pushToUsers(userIds,
  buildPayload)` where `buildPayload(language)` returns `{title, body, url, tag}` so
  copy is rendered per recipient. Chat helper `notify.chatMessage({campId, channel,
  groupId, authorId, text, roomMemberIds, connectedUserIds})` computes audience =
  `roomMemberIds − authorId − connectedUserIds` and calls `pushToUsers`.
- `chat.handlers.ts` `chat:send`: after broadcasting `chat:message`, gather the
  room's member ids (reuse `chatService.groupMembers`/`organizerMembers`) and the
  connected ids (`io.in(room).fetchSockets()`), then call `notify.chatMessage`.
- `src/i18n/notifications.ts`: `{ chatMessage: { uz, ru, en } }` templates → title
  = group/organizers label, body = `"{sender}: {snippet}"` (snippet = text, ~80 chars).
- `user.model.ts`: add `language: 'uz' | 'ru' | 'en'` (default `'uz'`).
  `PATCH /auth/me` accepts optional `language`; `completeProfile`/profile update
  stores it. Its validator + OpenAPI updated.
- `config/env.ts`: add the three optional VAPID vars.

### Frontend

**1 · Reactions**
- Delete `reactionOverrides` from `useChatStore`; `toggleReaction` emits
  `chat:react` over the socket. Optimistically flip local `mine` + count for
  responsiveness; the `chat:reaction` echo reconciles counts.
- `realtimeBridge`: handle `chat:reaction` → `setQueryData` to replace that
  message's `reactions` (merge server counts, preserve local `mine`).
- `MessageList` reads reactions straight off the message (server truth); the
  `reactions` prop plumbing stays.

**2 · Read receipts**
- `realtimeBridge`: handle `chat:read` → update `othersLastReadAt` on the room's
  cached history object (`max(prev, evt.lastReadAt)` when `evt.userId !== me`).
- `ChatScreen`/`OrgChatScreen`: derive `status` for my messages —
  `othersLastReadAt && othersLastReadAt >= m.createdAt ? 'read' : 'sent'`. The bubble
  already renders `✓`/`✓✓`.
- Emit `chat:read` when a thread mounts and whenever a new message arrives while it
  is the active view.

**3 · Unread**
- `store/useChatUnreadStore.ts` (legit client UI state): `Record<roomKey, count>`,
  `seed`, `bump`, `clear`. `realtimeBridge` seeds from `chat:unread`, bumps on
  `chat:message` for a room not currently open, clears on thread open.
- `ParticipantDashboard`: the Chat-tab badge reads this store (replacing
  `home.unreadChat`). `OrganizerNav` gets the same badge for the org chat.

**4 · Push**
- `api/services/push.service.ts`: uncomment the two real axios calls (the contract
  already matches).
- Chat push `url` deep-links: participant → `/camp/chat`, organizers → the org chat
  route. Carried in the payload; the SW already navigates `data.url`.
- `i18n/useLanguageStore.ts`: on language change while authenticated, fire
  `PATCH /auth/me { language }` so the server can localize push.

### Setup / ops
- Generate VAPID keys once (`npx web-push generate-vapid-keys`) → `VAPID_PUBLIC_KEY`
  mirrored to the frontend as `VITE_VAPID_PUBLIC_KEY`. A short script documents it.

## Delivery bug (workstream 0 — do first)

Reproduce with two browser sessions in the same group, instrument the socket frames
and the `setQueryData` writes, and find where the live message stops. Prime
suspects: React StrictMode cycling the singleton socket (mount → cleanup →
mount), the handshake cookie over Vite's `/socket.io` proxy, or a `groupId` key
mismatch between the append and the read. **Acceptance:** a message from session A
appears in session B with no refresh, on both the group and organizers channels.
The fix ships before the feature workstreams, since they all ride live delivery.

## Non-goals

- Announcement / schedule / leaderboard push and their WS events — a **later batch**
  that plugs into this same `notify.service` (the remainder of the 2026-07-20 spec).
- SOS push/events — deferred with SOS.
- Reactor-identity UI ("who reacted") — we render count + `mine` only.
- Per-category push preferences — one master toggle stays (per the 2026-07-09 spec).
- Multi-instance fan-out (Redis pub/sub for rooms/debounce). In-process only.
- Delivery/read *split* ticks (grey ✓✓) — we ship the "seen by anyone" model only.

## Risks

- **In-process presence assumes one server instance.** `fetchSockets()` is
  single-process; revisit before horizontal scaling (same constraint the prior spec
  recorded).
- **iOS push requires an installed PWA** — already handled in the FE toggle's
  disabled state; expect low iOS opt-in.
- **Push language depends on a synced field** — users who never change language must
  still get sensible copy; default `'uz'`, backfill nothing.
- **Reaction `mine` is client-owned live.** Correct for the acting client and
  reconciled on reload; a second device of the *same* user won't flip its own `mine`
  live (only counts). Acceptable — reload reprojects it.

## Verification

- **Delivery:** two sessions, same group — A sends, B sees it with no refresh
  (group + organizers).
- **Reactions:** A reacts 👍; B sees the count rise live; A's chip shows `mine`,
  B's does not; both survive a refresh; A un-reacts → count drops for both.
- **Receipts:** A sends; while B has not opened the thread, A shows `✓`; B opens the
  thread → A flips to `✓✓` live.
- **Unread:** A (on Home) sees the Chat badge increment when B sends; opening Chat
  clears it and the badge stays clear on B's next read.
- **Push:** B with the app closed + notifications on receives A's message as an OS
  banner that deep-links to the chat; B with the app **open** in that room gets the
  socket update and **no** push; a Russian-set user gets Russian copy; revoking the
  subscription makes the next send `410` and prunes the row.

## Ship order

0. Delivery fix → 1. Reactions → 2. Read receipts → 3. In-app unread → 4. Push
(its own phase — heaviest, fully independent).

## Relationship to prior specs

- **`2026-07-21-realtime-chat-design.md`** — this extends it; the Socket.IO
  transport, rooms, and `chatService` are reused as-is.
- **`2026-07-20-realtime-delivery-design.md`** (root docs, approved, never built) —
  its **transport** decision (raw `ws` at `/ws`, `ws/registry.ts`) is **superseded**
  by the shipped Socket.IO layer. Its **push contract** (subscribe endpoints, env
  names, SW payload, `PushSubscription` model, `User.language`, server i18n map,
  skip-connected, prune-410, single `notify.service` fan-out) is **adopted verbatim**
  and implemented here for the **chat** slice. The announcement/schedule/leaderboard
  events from that spec remain a follow-up batch that plugs into the same
  `notify.service`.
