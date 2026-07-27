# Chat Offline — Persisted Cache & Send Outbox — Design

**Date:** 2026-07-27
**Surfaces:** backend (`camply-backend`), frontend (`camply-frontend`)
**Status:** approved, ready for planning
**Builds on:** `2026-07-27-chat-load-performance-design.md` — **ships after it.**
That spec's query-key change (`campKeys.chat(campId)`) is a hard prerequisite:
persisting a key that is about to change would strand every cached thread.

## Problem

Chat does not work offline at all, and it never has.

- The service worker (`src/sw.ts`) precaches only the app shell. It has **no
  fetch handler for `/api/*`**, so no chat request is ever served from cache.
- React Query's cache is memory-only with a default `gcTime` of 5 minutes.
  Backgrounding the PWA for six minutes is enough to go cold.
- Consequently, opening chat with no connection shows the *error* state — which
  reads to the user as "chat is broken," not "you're offline."
- Sending is fire-and-forget. `useChatStore.sendText` (`useChatStore.ts:39`)
  emits `chat:send` and returns. There is **no optimistic echo** despite comments
  claiming one — your own message does not render until the server broadcast
  returns. Offline, the message is silently, permanently lost: no queue, no
  error, no trace.

Camps run on weak, intermittent networks (ReadyProduct §9). A participant should
be able to open chat in a dead zone, read what was said, type a reply, and have
it send itself when signal returns.

## Decisions

- **Persist the React Query cache to IndexedDB**, not localStorage. IndexedDB is
  async (never blocks the main thread), has no ~5MB origin cap, and doesn't
  contend with the Zustand `persist` stores (auth, theme, camp draft) already
  living in localStorage. `idb-keyval` (~600 B gzipped) behind TanStack's async
  storage persister.
- **The outbox stays in localStorage** via the existing Zustand `persist`
  pattern. It is a handful of short strings and needs a *synchronous* read at
  boot to render pending bubbles on first paint. Mixing storages is deliberate:
  each is chosen for its access pattern, and both are cleared together on logout.
- **Persistence is allowlisted, not global.** Only chat threads, `myGroup`, and
  `myRole` persist. **Location / map data is explicitly excluded** — writing
  participant positions to disk widens the privacy guardrail (root `CLAUDE.md`:
  location is visible only to their organizer and group, only during camp hours)
  in a way nobody has signed off on.
- **Optimistic-first sending, always.** Every send enqueues and renders a
  `pending` bubble *before* touching the socket. Online this is a perceived
  latency win; offline it is the whole feature. One code path, not two.
- **Idempotency is server-enforced via `clientMsgId`**, mirroring the
  `clientRequestId` dedupe `campService.createFull` already uses. A socket that
  drops *after* the server persists but *before* the echo arrives will retry, and
  a retry must not double-post.
- **Flush on the socket's `connect` event**, which already fires on every
  reconnect. No polling, no separate scheduler.

## Architecture

### Backend (`camply-backend`)

**`src/models/message.model.ts`**
- New optional field `clientMsgId: { type: String, default: undefined }` (a
  client-generated UUID; never trusted for anything but dedupe).
- New index:
  ```js
  messageSchema.index(
    { authorId: 1, clientMsgId: 1 },
    { unique: true, partialFilterExpression: { clientMsgId: { $exists: true } } },
  )
  ```

> **This must be a PARTIAL index, not a sparse one.** A compound *sparse* index
> includes a document if it has **at least one** of the indexed fields — every
> existing message has an `authorId`, so all of them would be indexed with
> `clientMsgId: null`, and the second pre-existing message by any author would
> throw `E11000` under `unique`. A `partialFilterExpression` on
> `clientMsgId: { $exists: true }` indexes only messages that actually carry one.
> See `Backend/CLAUDE.md` → *Known gotcha — stale Mongo indexes*: Mongoose does
> not alter an existing index whose options changed, so if a wrong version of
> this index is ever created it must be dropped by hand
> (`db.messages.dropIndex('authorId_1_clientMsgId_1')`) before the right one can
> build.

**`src/validators/chat.validators.ts`** — `sendMessageSchema` gains
`clientMsgId: z.string().uuid().optional()`. Optional, so an older client that
doesn't send one keeps working unchanged.

**`src/services/chat.services.ts`** — `postMessage` accepts `clientMsgId?`. When
present, it first runs `MessageModel.findOne({ authorId, clientMsgId })`; on a
hit it returns that existing message's projection **without writing**. Otherwise
it creates as today, storing `clientMsgId`. `toChatMessage` includes
`clientMsgId` in its output so the sender can reconcile. The `E11000` from a
genuine race (two retries in flight at once) is caught and resolved by re-reading
the existing document — same defensive shape as `rosterService.add`.

**`src/sockets/chat.handlers.ts`** — `chat:send` passes `clientMsgId` through to
`postMessage` for both channels. The broadcast is unchanged in shape; the
`message` it carries now includes `clientMsgId`.

**Deliberate:** the dedupe hit still **re-broadcasts**. Other clients dedupe by
`id` in `appendMessage`, so a repeat is harmless, and re-broadcasting is what
lets the original sender reconcile a message whose first echo it missed.

### Frontend (`camply-frontend`)

**New deps:** `@tanstack/react-query-persist-client`,
`@tanstack/query-async-storage-persister`, `idb-keyval`. No UUID library —
`crypto.randomUUID()` is native and available in every PWA-capable browser.

**`src/api/queryClient.ts`**
- Chat queries get `gcTime: 7 * 24h`. This is load-bearing: React Query will not
  persist a query whose `gcTime` is shorter than the persister's `maxAge`.
- The persister is created over `idb-keyval` with `maxAge: 7 days` and a
  `dehydrateOptions.shouldDehydrateQuery` allowlist matching only chat,
  `myGroup`, and `myRole` keys.
- A `buster` string tied to the app version, so a deploy that changes the message
  shape invalidates persisted data instead of hydrating a stale shape.

**`src/main.tsx`** — swap `QueryClientProvider` for
`PersistQueryClientProvider`. Its `onSuccess` triggers a background revalidation
once hydration completes.

**`src/api/realtime/realtimeBridge.ts`**
- `appendMessage` caps cached history at **200** messages (slice from the end).
  Socket appends are unbounded over a long camp day; the cap bounds both memory
  and what gets written to disk.
- `chat:message` reconciliation: if the incoming message carries a `clientMsgId`
  matching a cached **pending** message (whose temporary `id` *is* that
  `clientMsgId`), **replace it in place** — real `id`, server `createdAt`,
  `status: 'sent'` — instead of appending. Then dequeue it from the outbox.
- The `connect` handler flushes the outbox (see below) after
  `chat:connectCamp`.
- Socket `connect` / `disconnect` update the new connection store.

**`src/store/useChatOutboxStore.ts`** (new, Zustand + `persist`)

```ts
type OutboxEntry = {
  clientMsgId: string        // crypto.randomUUID()
  campId: string
  channel: 'group' | 'organizers'
  text: string
  replyToId?: string
  createdAt: string          // ISO, for ordering
  status: 'queued' | 'sending' | 'failed'
  attempts: number
}
```

Actions: `enqueue`, `markSending`, `markFailed`, `dequeue`, `retry`, `clear`.
`flush(socket)` drains **oldest-first, sequentially** — order matters in a
conversation. `attempts` increments only on an explicit `chat:error`, never on a
mere disconnect; at **3** failed attempts an entry goes `failed` and stops
auto-retrying, awaiting a manual tap.

**`src/store/useChatStore.ts`** — `sendText` becomes: mint a `clientMsgId`,
`enqueue`, insert a pending `ChatMessage` into the query cache (`id` =
`clientMsgId`, `sentByMe: true`, `status: 'pending'`), then attempt the emit if
connected. `useOrgChatStore.sendText` follows the identical path with
`channel: 'organizers'`.

**`src/lib/chat.ts`** — `ChatMessage['status']` widens from `'sent' | 'read'` to
`'pending' | 'failed' | 'sent' | 'read'`. `MessageBubble` already switches on
`status`, so it gains two cases: a clock glyph at reduced opacity for `pending`,
and a tappable retry affordance (with an alert glyph) for `failed`.

**`src/store/useConnectionStore.ts`** (new, tiny) — `{ online: boolean }`, fed by
the socket's `connect`/`disconnect` and the window `online`/`offline` events.
Legitimate Zustand: it is connection state, not server data.

**`src/components/participant/chat/Composer.tsx`** — stays **enabled** offline.
When `!online`, a slim line above the input reads "Offline — messages will send
when you reconnect." New i18n keys `chat.offlineBanner`, `chat.pendingSend`,
`chat.sendFailed`, `chat.retry` in **EN / UZ / RU**.

**Logout** — the existing session teardown also clears the IndexedDB persister
and the outbox store. Non-negotiable: persisted chat is unencrypted message text
at rest, and camp devices get shared.

## Non-goals

- **No pagination / scrollback beyond the cap.** Carried over from the paired
  spec: the backend serves latest-50, the cache holds ≤200, and that's the
  product. Post-launch decision.
- **No offline reactions or read receipts.** Both are cheap, idempotent, and
  meaningless when stale — they simply no-op while disconnected. Only *sending
  text* is queued.
- **No offline attachments.** Chat is text-only server-side today.
- **No background sync API.** Flushing on reconnect while the app is open covers
  the real case; `SyncManager` has poor cross-browser support and would need its
  own auth story in the SW.
- **No SW-level runtime caching of `/api/*`.** The persisted query cache already
  gives us offline reads, with correct invalidation semantics that a Workbox
  route would fight with.
- **No encryption of the persisted cache.** Out of scope; mitigated by clearing
  on logout, and called out below as an accepted risk.

## Risks

- **The partial-vs-sparse index trap** (detailed above). Getting this wrong
  breaks *all* message sending in any DB with pre-existing messages, with a
  confusing `E11000` on a field the message doesn't even have. Highest-risk item
  in this spec.
- **Duplicate messages if reconciliation misses.** If a pending bubble isn't
  matched to its echo, the user sees their message twice (once pending forever,
  once real). Verification covers a same-device send explicitly.
- **Message text at rest, unencrypted, on the device.** Inherent to offline
  reads. Mitigated by the logout clear and the allowlist that keeps location data
  out. Flagged for sign-off rather than solved.
- **Ordering drift.** Pending bubbles sort by local `createdAt`; the server
  assigns its own on persist. A message queued offline for an hour will land in
  the thread at its *server* time, so it can visibly jump position on reconnect.
  Accepted — the alternative (client-authoritative timestamps) is worse.
- **Hydration flash.** IndexedDB reads are async, so there is a frame before the
  cache hydrates. `PersistQueryClientProvider` handles this, but the chat screen
  must show `ChatSkeleton` (from the paired spec) during it, not an error.
- **`buster` discipline.** Forgetting to bump it after a message-shape change
  hydrates stale-shaped data into a component that expects the new shape.

## Verification

No test runner in either repo. `npm run validate` in each, plus:

1. **Offline read:** load chat online, go offline (DevTools → Offline), fully
   reload the app. The last messages must render from cache — no error screen.
2. **Cold PWA launch:** install the PWA, load chat, force-quit, go offline,
   relaunch. Messages must be there.
3. **Offline send:** offline, send three messages. All three show as `pending`.
   Go online. All three send, in order, and flip to `sent` — with **no
   duplicates**.
4. **Dedupe under retry:** offline-send one message, then reconnect while
   throttled so a retry fires. Confirm exactly one document in Mongo
   (`db.messages.find({ clientMsgId: '<id>' }).count() === 1`).
5. **Index sanity:** on a DB that already has messages, boot the backend and send
   a normal message. Confirm no `E11000`. Verify with
   `db.messages.getIndexes()` that the index carries
   `partialFilterExpression`, not `sparse`.
6. **Privacy allowlist:** DevTools → Application → IndexedDB. Confirm chat keys
   are present and **no** map/location key is.
7. **Logout clears:** log out, inspect IndexedDB and localStorage. Both the
   persisted cache and the outbox must be gone.
8. **Failure path:** force a `chat:error` (send to a camp you've been removed
   from). The bubble goes `failed` after 3 attempts and offers retry.
9. **Trilingual:** all four new strings render in EN, UZ, and RU.

## Ship order

1. Backend: model field + **partial** index + validator + `postMessage` dedupe +
   handler passthrough. Shippable alone — an older client simply omits
   `clientMsgId`.
2. Frontend: persistence (deps, persister, allowlist, `PersistQueryClientProvider`,
   logout clear, 200-cap). Delivers offline *reads* on its own.
3. Frontend: outbox store + optimistic `sendText` + reconciliation + flush.
4. Frontend: connection store, offline banner, pending/failed bubble states, i18n.
5. Update `Frontend/CLAUDE.md` and `Backend/CLAUDE.md` in the same effort.
