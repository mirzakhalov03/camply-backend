# Chat Offline — Persisted Cache & Send Outbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a participant open chat with no connection, read the last messages, type a reply, and have it send itself when signal returns — without ever double-posting.

**Architecture:** Two halves. **Reads:** the React Query cache is persisted to IndexedDB behind an allowlist (chat only — location data is deliberately excluded), so a cold PWA launch paints from disk then revalidates. **Writes:** every send enqueues into a persisted outbox and renders a `pending` bubble *before* touching the socket; the socket's existing `connect` event drains the queue in order. Idempotency is server-enforced via a client-generated `clientMsgId`, mirroring the `clientRequestId` dedupe `campService.createFull` already uses.

**Tech Stack:** Backend — Express 5, Mongoose 9, Zod 4 (import `z` from `config/zod`), Socket.IO. Frontend — React 19, TanStack Query v5 + `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` (new), `idb-keyval` (new), Zustand `persist`, `socket.io-client`.

**Spec:** `docs/superpowers/specs/2026-07-27-chat-offline-outbox-design.md`

> **HARD PREREQUISITE:** `2026-07-27-chat-load-performance.md` must be fully merged first. This plan persists `campKeys.chat(campId)` — the single-argument key that plan introduces. Persisting the old two-argument key would strand every cached thread the moment that change lands. Verify before starting: `grep -rn "campKeys.chat(" Frontend/src/` must show only single-argument calls.

## Global Constraints

- **No test runner** — both CLAUDE.md files forbid it. "Verify" = `npm run typecheck` (or `npm run validate`) **plus** the manual runtime check each task names. Never add a test file or a test dependency.
- **Two repos.** `Frontend/` and `Backend/` are separate git repos; the monorepo root is **not** a repo. Commit inside the repo you changed. Mirror plan/spec edits into both `docs/superpowers/`.
- **Backend layering:** `routes → controllers → services → models`. Controllers thin, no try/catch. Business logic in services. Throw `new HttpError(status, message)`.
- **Backend validation:** every input gets a Zod schema in `validators/`; **import `z` from `../config/zod`**, never `'zod'`, or `.openapi()` metadata won't attach.
- **Server is the authority.** Socket rooms stay server-derived; every event re-checks entitlement exactly as `chat:send` does. A client-sent `groupId` is never trusted. `clientMsgId` is trusted for **dedupe only** — never for identity, ordering, or authorization.
- **Frontend data philosophy:** server data → React Query only, never mirrored into Zustand. The outbox is *not* server data — it is un-sent client intent, so Zustand is correct for it. Confirmed messages live only in the query cache.
- **Frontend imports:** `@/` alias in files you touch; `import type { … }` for type-only imports (`verbatimModuleSyntax` is on).
- **Trilingual:** every new string ships **UZ / RU / EN** in `src/i18n/translations.ts` — add to the `ChatStrings` type **and** all three language blocks, or the build fails.
- **Privacy guardrail (root `CLAUDE.md`):** participant location is visible only to their organizer and group, only during camp hours. **Nothing location-related may be persisted to disk.** The dehydrate allowlist is the enforcement point and is not optional.
- **Design system:** theme tokens only (`bg-canvas`, `bg-surface`, `text-muted`, `bg-line`, `bg-soft`). Dark mode must keep working.
- **Prettier:** no semicolons, single quotes, trailing commas, width 100. Format only files you touch: `npx prettier --write --end-of-line auto <files>`.

---

## Workstream 1 — Backend idempotency (independent, ship first)

### Task 1: `clientMsgId` on `Message` — partial unique index + dedupe

A socket that drops *after* the server persists but *before* the echo arrives will be retried by the outbox. Without server-side dedupe that retry double-posts. This task makes `postMessage` idempotent per `(author, clientMsgId)`.

An older client that omits `clientMsgId` keeps working unchanged, so this ships alone.

**Files:**
- Modify: `Backend/src/models/message.model.ts`
- Modify: `Backend/src/validators/chat.validators.ts` (`sendMessageSchema`)
- Modify: `Backend/src/services/chat.services.ts` (`ChatMessage` type, `toChatMessage`, `postMessage`)
- Modify: `Backend/src/sockets/chat.handlers.ts` (`chat:send`, both channel branches)

**Interfaces:**
- Produces:
  - `Message.clientMsgId?: string`
  - `ChatMessage.clientMsgId?: string` — present in every `chat:message` broadcast and every history payload. **Task 6 reconciles pending bubbles against this field.**
  - `chatService.postMessage({ …, clientMsgId?: string })` — idempotent when supplied.
  - `sendMessageSchema` accepts an optional `clientMsgId` UUID.

- [ ] **Step 1: Add the field and the PARTIAL index**

`Backend/src/models/message.model.ts` — add to the schema, after `text`:

```ts
    // Client-generated UUID for send idempotency. The outbox retries a send whose
    // echo it never saw; without this, a retry after a successful persist would
    // double-post. Trusted for DEDUPE ONLY — never identity, ordering, or authz.
    clientMsgId: { type: String, default: undefined },
```

and add the index beside the existing one:

```ts
/*
  Send idempotency: one message per (author, clientMsgId).

  This MUST be `partialFilterExpression`, NOT `sparse`. A compound sparse index
  includes a document that has AT LEAST ONE of the indexed fields — every
  existing message has an authorId, so all of them would be indexed with
  clientMsgId: null, and the second pre-existing message by any author would
  throw E11000 under `unique`. A partial index covers only documents that
  actually carry a clientMsgId.
*/
messageSchema.index(
  { authorId: 1, clientMsgId: 1 },
  { unique: true, partialFilterExpression: { clientMsgId: { $exists: true } } },
)
```

- [ ] **Step 2: Accept it on the wire**

`Backend/src/validators/chat.validators.ts` — add to `sendMessageSchema`, after `replyToId`:

```ts
  // Client-generated idempotency key. Optional: an older client that omits it
  // behaves exactly as before. Never trusted beyond dedupe.
  clientMsgId: z.string().uuid('Invalid clientMsgId').optional(),
```

- [ ] **Step 3: Carry it through the projection**

`Backend/src/services/chat.services.ts` — add to the `ChatMessage` type:

```ts
export type ChatMessage = {
  id: string
  authorId: string
  kind: 'text'
  text: string
  time: string // HH:MM
  createdAt: string // ISO — the client can re-derive `time` and ordering
  reactions: MessageReaction[]
  replyTo?: ReplySnapshot
  /** Echoed back so the sender can match this to its optimistic bubble. */
  clientMsgId?: string
}
```

and to `toChatMessage`'s returned object, after `replyTo`:

```ts
    clientMsgId: doc.clientMsgId ?? undefined,
```

- [ ] **Step 4: Make `postMessage` idempotent**

Same file. Add `clientMsgId?: string` to the input type, then guard the write. Insert this **immediately after** the `const groupId = …` line and **before** the `replyTo` resolution (a dedupe hit must skip that work too):

```ts
    // Idempotency: the outbox retries a send whose echo it never saw. Same shape
    // as campService.createFull's clientRequestId dedupe.
    if (input.clientMsgId) {
      const existing = await MessageModel.findOne({
        authorId: input.authorId,
        clientMsgId: input.clientMsgId,
      }).lean()
      if (existing) return toChatMessage(existing)
    }
```

Then pass it to `MessageModel.create({ …, clientMsgId: input.clientMsgId })`, and wrap the create so a genuine race (two retries in flight simultaneously) resolves instead of 500-ing — the same defensive shape `rosterService.add` uses for its `E11000`:

```ts
    try {
      const doc = await MessageModel.create({
        campId: input.campId,
        channel: input.channel,
        groupId,
        authorId: input.authorId,
        text: input.text,
        replyTo,
        clientMsgId: input.clientMsgId,
      })
      return toChatMessage(doc)
    } catch (err) {
      // Two retries raced past the findOne above; the index is the tiebreaker.
      // Re-read the winner instead of failing the send.
      if ((err as { code?: number }).code === 11000 && input.clientMsgId) {
        const won = await MessageModel.findOne({
          authorId: input.authorId,
          clientMsgId: input.clientMsgId,
        }).lean()
        if (won) return toChatMessage(won)
      }
      throw err
    }
```

- [ ] **Step 5: Pass it through the socket handler**

`Backend/src/sockets/chat.handlers.ts` — in `chat:send`, destructure it and forward to **both** channel branches:

```ts
    const { campId, channel, text, replyToId, clientMsgId } = parsed.data
```

and add `clientMsgId,` to each of the two `chatService.postMessage({ … })` calls.

**Deliberate:** a dedupe hit still re-broadcasts. Other clients dedupe by `id` in `appendMessage`, so a repeat is harmless — and re-broadcasting is exactly what lets the original sender reconcile a message whose first echo it missed.

- [ ] **Step 6: Verify — typecheck**

```bash
cd Backend && npm run validate
```

Expected: clean.

- [ ] **Step 7: Verify — the index is PARTIAL, on a DB that already has messages**

This is the highest-risk step in the whole plan. Get it wrong and **all** message sending breaks with a confusing `E11000` on a field the message doesn't have.

```bash
cd Backend && npm run dev
```

Then in `mongosh`:

```js
db.messages.getIndexes()
```

Expected: an entry named `authorId_1_clientMsgId_1` carrying **`partialFilterExpression: { clientMsgId: { $exists: true } }`** and `unique: true`. It must **not** say `sparse: true`.

If it is wrong (e.g. a previous attempt built it as sparse), Mongoose will **not** alter it — drop it by hand and restart, per `Backend/CLAUDE.md` → *Known gotcha — stale Mongo indexes*:

```js
db.messages.dropIndex('authorId_1_clientMsgId_1')
```

Now send a normal message from the app on that same DB.

Expected: it sends. No `E11000`.

- [ ] **Step 8: Verify — dedupe actually dedupes**

The frontend doesn't send `clientMsgId` yet, so exercise it directly. In `mongosh`, confirm the count before and after replaying the same id twice via two rapid sends from a socket client — or simplest, assert the constraint holds:

```js
// Should succeed once, then throw E11000 on the duplicate.
const a = db.messages.findOne({})
db.messages.insertOne({ ...a, _id: ObjectId(), clientMsgId: 'test-dupe-key' })
db.messages.insertOne({ ...a, _id: ObjectId(), clientMsgId: 'test-dupe-key' })
```

Expected: the second insert throws a duplicate-key error. Clean up:

```js
db.messages.deleteMany({ clientMsgId: 'test-dupe-key' })
```

- [ ] **Step 9: Commit**

```bash
cd Backend
npx prettier --write --end-of-line auto src/models/message.model.ts src/validators/chat.validators.ts src/services/chat.services.ts src/sockets/chat.handlers.ts
git add -A
git commit -m "feat(chat): clientMsgId send idempotency

The offline outbox retries a send whose echo it never saw; without server
dedupe a retry after a successful persist double-posts. postMessage is now
idempotent per (authorId, clientMsgId), and the id is echoed on the broadcast
so the sender can reconcile its optimistic bubble.

The index is PARTIAL, not sparse: a compound sparse index covers docs having
at least one indexed field, so every pre-existing message (authorId present,
clientMsgId absent) would collide under unique.

Optional on the wire — an older client that omits it is unaffected.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Workstream 2 — Offline reads (persisted cache)

### Task 2: Persist the query cache to IndexedDB behind an allowlist

Delivers offline *reads* on its own — the outbox is a separate task.

**Files:**
- Modify: `Frontend/package.json` (three deps)
- Create: `Frontend/src/api/persister.ts`
- Modify: `Frontend/src/api/queryClient.ts`
- Modify: `Frontend/src/main.tsx`
- Modify: `Frontend/src/api/realtime/realtimeBridge.ts` (`appendMessage` cap)
- Modify: `Frontend/src/api/queries/auth.queries.ts:70-76` (logout clear)

**Interfaces:**
- Consumes: `campKeys.chat(campId)` (single-arg, from the load-performance plan).
- Produces:
  - `persister` — the async storage persister, and `clearPersistedCache(): Promise<void>`, both from `@/api/persister`.
  - `PERSISTED_MAX_AGE` — exported const, shared by the persister and `queryClient`'s `gcTime`.
  - **Task 5 calls `clearPersistedCache()` on logout alongside the outbox clear.**

- [ ] **Step 1: Install the dependencies**

```bash
cd Frontend
npm install @tanstack/react-query-persist-client @tanstack/query-async-storage-persister idb-keyval
```

No UUID library — `crypto.randomUUID()` is native in every PWA-capable browser.

- [ ] **Step 2: Create the persister with the privacy allowlist**

`Frontend/src/api/persister.ts`:

```ts
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { get, set, del } from 'idb-keyval'
import type { Query } from '@tanstack/react-query'

const IDB_KEY = 'camply-query-cache'

/*
  How long a persisted entry stays usable. Also the floor for gcTime — React
  Query refuses to persist a query whose gcTime is SHORTER than this, so the two
  must move together (see queryClient.ts).
*/
export const PERSISTED_MAX_AGE = 7 * 24 * 60 * 60 * 1000 // 7 days

/*
  Bump on any change to a persisted payload's SHAPE. A stale buster hydrates
  old-shaped data into a component expecting the new shape — a class of bug that
  only reproduces on returning users, never on your machine.
*/
export const PERSIST_BUSTER = 'chat-v1'

/*
  What is allowed to touch the disk. An ALLOWLIST, not a blocklist — this is the
  enforcement point for the privacy guardrail in the root CLAUDE.md: participant
  location is visible only to their organizer and group, only during camp hours,
  so map/location data must NEVER be written to disk. Adding a key here is a
  privacy decision, not a performance one.
*/
const PERSISTED_SEGMENTS = ['chat', 'chatOrganizers', 'myGroup', 'myRole'] as const

export function shouldPersistQuery(query: Query): boolean {
  return query.queryKey.some(
    (segment) =>
      typeof segment === 'string' &&
      (PERSISTED_SEGMENTS as readonly string[]).includes(segment),
  )
}

// IndexedDB, not localStorage: async (never blocks the main thread), no ~5MB
// origin cap, and no contention with the Zustand persist stores (auth, theme,
// camp draft) that already live in localStorage.
export const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => (await get(key)) ?? null,
    setItem: async (key, value) => set(key, value),
    removeItem: async (key) => del(key),
  },
  key: IDB_KEY,
})

/** Wipe the on-disk cache. Called on logout — chat text at rest, shared devices. */
export async function clearPersistedCache(): Promise<void> {
  await del(IDB_KEY)
}
```

- [ ] **Step 3: Raise `gcTime` so chat survives long enough to persist**

`Frontend/src/api/queryClient.ts`:

```ts
import { QueryClient } from '@tanstack/react-query'
import { PERSISTED_MAX_AGE } from './persister'

// Central React Query config. `staleTime` avoids refetching data that's
// still fresh; tune per-query when a resource needs different behavior.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
      /*
        Must be >= the persister's maxAge or NOTHING persists: React Query
        garbage-collects the entry before it can be written back. This is a
        default; only allowlisted keys actually reach the disk (see persister.ts).
      */
      gcTime: PERSISTED_MAX_AGE,
    },
  },
})
```

- [ ] **Step 4: Swap the provider**

`Frontend/src/main.tsx` — replace `QueryClientProvider` with `PersistQueryClientProvider`:

```tsx
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { queryClient } from '@/api/queryClient'
import {
  persister,
  shouldPersistQuery,
  PERSISTED_MAX_AGE,
  PERSIST_BUSTER,
} from '@/api/persister'
```

and the JSX (keep every existing child exactly as it is):

```tsx
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSISTED_MAX_AGE,
        buster: PERSIST_BUSTER,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
    >
      {/* …existing children unchanged… */}
    </PersistQueryClientProvider>
```

- [ ] **Step 5: Bound the cached history**

Socket appends are unbounded over a long camp day. Cap what's held — and therefore what's written to disk. In `Frontend/src/api/realtime/realtimeBridge.ts`, update `appendMessage`:

```ts
/*
  The cache is bounded, so a long camp day can't grow it (or the persisted copy)
  without limit. The server only ever serves the latest 50; 200 is generous
  headroom for a session's live appends. Scrollback beyond this is a post-launch
  decision — see the spec's non-goals.
*/
const MAX_CACHED_MESSAGES = 200

/** Append a message into a room's cached history, deduped by id. */
function appendMessage(key: readonly unknown[], message: ChatMessage) {
  queryClient.setQueryData(key, (prev: unknown) => {
    const data = (prev ?? { messages: [] }) as { messages?: ChatMessage[]; [k: string]: unknown }
    const messages = Array.isArray(data.messages) ? data.messages : []
    if (messages.some((m) => m.id === message.id)) return data
    return { ...data, messages: [...messages, message].slice(-MAX_CACHED_MESSAGES) }
  })
}
```

- [ ] **Step 6: Clear the disk on logout**

`Frontend/src/api/queries/auth.queries.ts` — the logout path currently calls `clear()` then `queryClient.clear()`. `queryClient.clear()` empties memory but **not** IndexedDB. Add the disk wipe:

```ts
      clear()
      void clearPersistedCache()
      queryClient.clear()
```

with `import { clearPersistedCache } from '@/api/persister'` at the top.

> Do the same at the 401 interceptor in `src/api/axiosInstance.ts:55` **only if** it already clears the query cache. If it just calls `useAuthStore.getState().clear()`, leave it — a transient 401 shouldn't nuke offline data. A real logout goes through `auth.queries.ts`.

- [ ] **Step 7: Verify — typecheck**

```bash
cd Frontend && npm run validate
```

Expected: clean.

- [ ] **Step 8: Verify — data reaches the disk, and the right data only**

Load the Chat tab online. DevTools → Application → IndexedDB → `keyval-store` → `camply-query-cache`.

Expected: an entry exists, and inspecting its `clientState.queries` shows chat/`myGroup`/`myRole` keys.
**Expected absent:** any key containing `'map'`. If a map key is there, `shouldPersistQuery` is wrong — stop and fix it before continuing. This is the privacy guardrail.

- [ ] **Step 9: Verify — offline read**

With chat loaded, DevTools → Network → **Offline**, then **hard-reload the whole app**.

Expected: the thread renders the last messages from cache. **No error screen.** (The composer will still look normal — offline send lands in Task 4.)

- [ ] **Step 10: Verify — cold PWA launch**

Install the PWA (or use `npm run build && npm run preview`). Load chat, force-quit the app, turn the device/browser offline, relaunch.

Expected: messages are there.

- [ ] **Step 11: Verify — logout wipes it**

Log out. DevTools → Application → IndexedDB.

Expected: `camply-query-cache` is gone.

- [ ] **Step 12: Commit**

```bash
cd Frontend
npx prettier --write --end-of-line auto src/api/persister.ts src/api/queryClient.ts src/main.tsx src/api/realtime/realtimeBridge.ts src/api/queries/auth.queries.ts
git add -A
git commit -m "feat(chat): persist the query cache to IndexedDB for offline reads

Chat had no offline story: the SW precaches only the app shell and the query
cache was memory-only with a 5min gcTime. A cold launch — or six backgrounded
minutes — showed the error screen.

Persisted behind an ALLOWLIST (chat, myGroup, myRole). Location/map data is
explicitly excluded: writing participant positions to disk would widen the
privacy guardrail in the root CLAUDE.md. Cleared on logout (message text at
rest, shared devices). Cached history capped at 200.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Workstream 3 — Queued sending (the outbox)

### Task 3: The outbox store

Pure state + logic, no UI. `sendText` rewiring is Task 4.

**Files:**
- Create: `Frontend/src/store/useChatOutboxStore.ts`
- Modify: `Frontend/src/lib/chat.ts` (`MessageStatus`, `ChatMessage.clientMsgId`)

**Interfaces:**
- Consumes: `ChatMessage` from `@/lib/chat`.
- Produces:
  - `MessageStatus` widens to `'pending' | 'failed' | 'sent' | 'read'`.
  - `ChatMessage.clientMsgId?: string`.
  - `OutboxEntry` (exported type).
  - `useChatOutboxStore` with `entries: OutboxEntry[]`, `enqueue(entry)`, `markSending(id)`, `markFailed(id)`, `dequeue(id)`, `retry(id)`, `clear()`.
  - `MAX_SEND_ATTEMPTS = 3`.
  - **Task 4 calls `enqueue`; Task 6 calls `dequeue`; Task 5 calls `clear`.**

- [ ] **Step 1: Widen the message contract**

`Frontend/src/lib/chat.ts`:

```ts
/*
  Delivery state for messages I send.
  pending → queued locally, not yet acknowledged by the server (offline, or
  in flight). failed → the server rejected it, or it ran out of attempts.
  sent → one tick. read → two ticks.
*/
export type MessageStatus = 'pending' | 'failed' | 'sent' | 'read'
```

and add to `ChatMessage`, after `createdAt`:

```ts
  /*
    Set on messages I originated. While pending, the message's `id` IS this
    value — the real server id replaces it when the echo arrives. Lets the
    bridge match an echo to its optimistic bubble instead of appending a
    duplicate.
  */
  clientMsgId?: string
```

- [ ] **Step 2: Create the store**

`Frontend/src/store/useChatOutboxStore.ts`:

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/*
  Messages typed but not yet acknowledged by the server. NOT server data — this
  is un-sent client intent, which is exactly what Zustand is for. Confirmed
  messages live only in the React Query cache.

  localStorage (not the IndexedDB query cache) on purpose: the queue is a handful
  of short strings and it needs a SYNCHRONOUS read at boot so pending bubbles
  render on the first paint, before IndexedDB hydration finishes.
*/
export type OutboxEntry = {
  /** crypto.randomUUID() — also the pending message's temporary id. */
  clientMsgId: string
  campId: string
  channel: 'group' | 'organizers'
  text: string
  replyToId?: string
  /** ISO. Drives oldest-first flush order — a conversation must stay ordered. */
  createdAt: string
  status: 'queued' | 'sending' | 'failed'
  attempts: number
}

/*
  Only an explicit chat:error counts as an attempt. A disconnect is not a
  failure — it's the normal offline case, and counting it would burn the budget
  before the user ever regains signal.
*/
export const MAX_SEND_ATTEMPTS = 3

type OutboxState = {
  entries: OutboxEntry[]
  enqueue: (entry: Omit<OutboxEntry, 'status' | 'attempts'>) => void
  markSending: (clientMsgId: string) => void
  markFailed: (clientMsgId: string) => void
  dequeue: (clientMsgId: string) => void
  retry: (clientMsgId: string) => void
  clear: () => void
}

const patch = (entries: OutboxEntry[], id: string, next: Partial<OutboxEntry>) =>
  entries.map((e) => (e.clientMsgId === id ? { ...e, ...next } : e))

export const useChatOutboxStore = create<OutboxState>()(
  persist(
    (set) => ({
      entries: [],

      enqueue: (entry) =>
        set((s) => ({ entries: [...s.entries, { ...entry, status: 'queued', attempts: 0 }] })),

      markSending: (clientMsgId) =>
        set((s) => ({ entries: patch(s.entries, clientMsgId, { status: 'sending' }) })),

      // Burn one attempt; past the cap the entry stops auto-retrying and waits
      // for a manual tap.
      markFailed: (clientMsgId) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.clientMsgId === clientMsgId
              ? { ...e, status: 'failed', attempts: e.attempts + 1 }
              : e,
          ),
        })),

      // Confirmed by the server — it lives in the query cache now.
      dequeue: (clientMsgId) =>
        set((s) => ({ entries: s.entries.filter((e) => e.clientMsgId !== clientMsgId) })),

      // Manual retry resets the budget: the user is asserting it's worth another go.
      retry: (clientMsgId) =>
        set((s) => ({ entries: patch(s.entries, clientMsgId, { status: 'queued', attempts: 0 }) })),

      clear: () => set({ entries: [] }),
    }),
    { name: 'camply-chat-outbox' },
  ),
)

/** Everything still worth sending, oldest first. */
export function pendingEntries(entries: OutboxEntry[]): OutboxEntry[] {
  return entries
    .filter((e) => e.status !== 'failed' || e.attempts < MAX_SEND_ATTEMPTS)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
```

- [ ] **Step 3: Verify — typecheck**

```bash
cd Frontend && npm run validate
```

Expected: clean. Widening `MessageStatus` may surface exhaustive `switch` errors in `MessageBubble` — if so, that's Task 5's job; note them and move on only if `validate` still passes. If it fails, add the two cases now as no-op fallthroughs and finish them properly in Task 5.

- [ ] **Step 4: Commit**

```bash
cd Frontend
npx prettier --write --end-of-line auto src/store/useChatOutboxStore.ts src/lib/chat.ts
git add -A
git commit -m "feat(chat): outbox store for un-sent messages

Un-sent client intent, persisted to localStorage so pending bubbles survive a
relaunch and render on first paint (synchronous read, unlike the IndexedDB
query cache). MessageStatus widens to pending|failed|sent|read.

Attempts are burned only by an explicit chat:error — a disconnect is the
normal offline case, not a failure.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Optimistic sending + flush on reconnect

Rewires both send paths to go through the outbox, and drains it when the socket connects. This also fixes a latent bug: `sendText` was fire-and-forget with **no optimistic echo** despite comments claiming one, so your own message didn't render until the server round-tripped.

**Files:**
- Create: `Frontend/src/api/realtime/outboxFlush.ts`
- Modify: `Frontend/src/store/useChatStore.ts` (`sendText`)
- Modify: `Frontend/src/store/useOrgChatStore.ts` (`sendText`)
- Modify: `Frontend/src/api/realtime/realtimeBridge.ts` (`connect` handler, `chat:error` handler)

**Interfaces:**
- Consumes: `useChatOutboxStore`, `pendingEntries`, `MAX_SEND_ATTEMPTS` (Task 3); `campKeys.chat(campId)`.
- Produces:
  - `enqueueAndEcho(input): string` from `@/api/realtime/outboxFlush` — enqueues, inserts the pending bubble, attempts the emit, returns the `clientMsgId`. **Both stores call this.**
  - `flushOutbox(): void` — drains oldest-first. **Called from the bridge's `connect` handler.**

- [ ] **Step 1: Create the flush module**

`Frontend/src/api/realtime/outboxFlush.ts`. It lives beside the bridge because it owns socket-adjacent behavior, and keeping it out of the bridge keeps that file focused.

```ts
import { queryClient } from '@/api/queryClient'
import { campKeys } from '@/api/queryKeys'
import { useAuthStore } from '@/store/useAuthStore'
import {
  useChatOutboxStore,
  pendingEntries,
  MAX_SEND_ATTEMPTS,
  type OutboxEntry,
} from '@/store/useChatOutboxStore'
import type { ChatMessage } from '@/lib/chat'
import { getSocket } from './realtimeBridge'

const keyFor = (campId: string, channel: 'group' | 'organizers') =>
  channel === 'group' ? campKeys.chat(campId) : campKeys.chatOrganizers(campId)

/** The optimistic bubble for a queued entry. Its id IS the clientMsgId until confirmed. */
function pendingMessage(entry: OutboxEntry): ChatMessage {
  const created = new Date(entry.createdAt)
  return {
    id: entry.clientMsgId,
    clientMsgId: entry.clientMsgId,
    authorId: useAuthStore.getState().user?.id ?? '',
    kind: 'text',
    text: entry.text,
    time: created.toTimeString().slice(0, 5),
    createdAt: entry.createdAt,
    sentByMe: true,
    status: 'pending',
    reactions: [],
  }
}

function insertPending(entry: OutboxEntry) {
  queryClient.setQueryData(keyFor(entry.campId, entry.channel), (prev: unknown) => {
    const data = (prev ?? { messages: [] }) as { messages?: ChatMessage[]; [k: string]: unknown }
    const messages = Array.isArray(data.messages) ? data.messages : []
    if (messages.some((m) => m.id === entry.clientMsgId)) return data
    return { ...data, messages: [...messages, pendingMessage(entry)] }
  })
}

function emit(entry: OutboxEntry) {
  const socket = getSocket()
  if (!socket?.connected) return // stays queued; the connect handler will flush it
  useChatOutboxStore.getState().markSending(entry.clientMsgId)
  socket.emit('chat:send', {
    campId: entry.campId,
    channel: entry.channel,
    text: entry.text,
    replyToId: entry.replyToId,
    clientMsgId: entry.clientMsgId,
  })
}

/*
  The ONE send path, online and off. Queue first, render first, THEN try the
  socket — so a send always looks instant and never disappears. The server's
  clientMsgId dedupe makes the retry safe.
*/
export function enqueueAndEcho(input: {
  campId: string
  channel: 'group' | 'organizers'
  text: string
  replyToId?: string
}): string {
  const clientMsgId = crypto.randomUUID()
  const entry: OutboxEntry = {
    ...input,
    clientMsgId,
    createdAt: new Date().toISOString(),
    status: 'queued',
    attempts: 0,
  }
  useChatOutboxStore.getState().enqueue(entry)
  insertPending(entry)
  emit(entry)
  return clientMsgId
}

/*
  Drain the queue oldest-first — a conversation has to stay in order. Called on
  every socket connect (which includes reconnects), so regaining signal is the
  only trigger needed.
*/
export function flushOutbox(): void {
  const socket = getSocket()
  if (!socket?.connected) return
  for (const entry of pendingEntries(useChatOutboxStore.getState().entries)) {
    if (entry.attempts >= MAX_SEND_ATTEMPTS) continue
    // Re-insert in case the cache was cleared or GC'd since it was queued.
    insertPending(entry)
    emit(entry)
  }
}
```

- [ ] **Step 2: Route the participant send through it**

`Frontend/src/store/useChatStore.ts` — replace `sendText`:

```ts
  sendText: (campId, _groupId, text, replyToId) => {
    const clean = text.trim()
    if (!clean) return
    // Queue + optimistic bubble + emit. The server re-derives groupId from
    // membership, so channel is enough on the wire.
    enqueueAndEcho({ campId, channel: 'group', text: clean, replyToId })
  },
```

with `import { enqueueAndEcho } from '@/api/realtime/outboxFlush'`.

- [ ] **Step 3: Route the organizer send through it**

`Frontend/src/store/useOrgChatStore.ts` — its `sendText` takes a channel. Replace its emit with the same call, passing that channel through:

```ts
    enqueueAndEcho({ campId, channel, text: clean, replyToId })
```

> Read the existing signature before editing — match its parameter names and order exactly; only the body changes.

- [ ] **Step 4: Flush on connect, and handle send errors**

`Frontend/src/api/realtime/realtimeBridge.ts` — in the `connect` handler, after the invalidations added by the load-performance plan:

```ts
    // Regaining signal is the only trigger the outbox needs.
    flushOutbox()
```

And replace/add the `chat:error` handler so a rejected send is visible rather than stuck as a permanent `pending`:

```ts
  socket.on('chat:error', (evt: { code?: string; message?: string; clientMsgId?: string }) => {
    if (!evt.clientMsgId) return // not a send failure we can attribute
    useChatOutboxStore.getState().markFailed(evt.clientMsgId)
    const entry = useChatOutboxStore
      .getState()
      .entries.find((e) => e.clientMsgId === evt.clientMsgId)
    if (!entry) return
    const key = entry.channel === 'group' ? campKeys.chat(entry.campId) : campKeys.chatOrganizers(entry.campId)
    queryClient.setQueryData(key, (prev: unknown) => {
      const data = prev as { messages?: ChatMessage[] } | undefined
      if (!data?.messages) return data
      return {
        ...data,
        messages: data.messages.map((m) =>
          m.id === evt.clientMsgId ? { ...m, status: 'failed' as const } : m,
        ),
      }
    })
  })
```

with `import { flushOutbox } from './outboxFlush'` and `import { useChatOutboxStore } from '@/store/useChatOutboxStore'`.

> **Backend follow-up required for attribution.** `chat:error` does not currently echo a `clientMsgId`, so the handler above will no-op on real failures. In `Backend/src/sockets/chat.handlers.ts`, add `clientMsgId` to every `socket.emit('chat:error', …)` inside `chat:send` — parse it off the payload first so even the `invalid` branch can attribute (fall back to `undefined` when the payload didn't parse). Do this now, in this task, and include it in this task's commit.

- [ ] **Step 5: Verify — typecheck both repos**

```bash
cd Frontend && npm run validate && cd ../Backend && npm run validate
```

Expected: clean.

- [ ] **Step 6: Verify — online send feels instant**

Send a message with a normal connection.

Expected: the bubble appears **immediately** (before the server round-trip), then settles to `sent`. Exactly **one** bubble — if you see two, reconciliation (Task 6) isn't in place yet, which is expected at this point in the plan; note it and continue.

- [ ] **Step 7: Verify — offline queueing**

DevTools → Network → **Offline**. Send three messages.

Expected: all three appear and stay. DevTools → Application → Local Storage → `camply-chat-outbox` shows three entries.

Set Network to **No throttling**.

Expected: the socket reconnects and all three send **in order**. Check Mongo: `db.messages.find().sort({createdAt:-1}).limit(5)` — exactly three new documents, no duplicates.

- [ ] **Step 8: Commit**

```bash
cd Frontend
npx prettier --write --end-of-line auto src/api/realtime/outboxFlush.ts src/store/useChatStore.ts src/store/useOrgChatStore.ts src/api/realtime/realtimeBridge.ts
git add -A
git commit -m "feat(chat): optimistic sending through the outbox, flush on reconnect

sendText was fire-and-forget with no optimistic echo (despite comments
claiming one) — your own message didn't render until the server round-tripped,
and offline it was silently lost forever.

Now one path for online and off: queue, render, then emit. Drains oldest-first
on the socket's connect event, which already fires on every reconnect.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"

cd ../Backend
npx prettier --write --end-of-line auto src/sockets/chat.handlers.ts
git add -A
git commit -m "feat(chat): echo clientMsgId on chat:error so a client can attribute a failed send

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Reconcile echoes against pending bubbles

Without this, a confirmed message appends **next to** its own pending bubble — the user sees every message twice.

**Files:**
- Modify: `Frontend/src/api/realtime/realtimeBridge.ts` (`appendMessage`, `chat:message` handler)

**Interfaces:**
- Consumes: `ChatMessage.clientMsgId` (Task 3), `useChatOutboxStore.dequeue` (Task 3), server-echoed `clientMsgId` (Task 1).
- Produces: no new exports. `appendMessage` gains reconcile behavior.

- [ ] **Step 1: Replace-in-place instead of appending**

`Frontend/src/api/realtime/realtimeBridge.ts` — replace `appendMessage`:

```ts
/*
  Land a message in a room's cached history.

  Three cases, in order:
  1. It's the echo of MY optimistic bubble (its clientMsgId matches a cached
     message whose temporary id IS that clientMsgId) -> replace in place, so the
     bubble becomes real rather than appearing twice.
  2. Already present by id -> no-op (another client's re-broadcast, or the
     server's idempotent replay of a deduped send).
  3. Otherwise -> append, capped.
*/
function appendMessage(key: readonly unknown[], message: ChatMessage) {
  queryClient.setQueryData(key, (prev: unknown) => {
    const data = (prev ?? { messages: [] }) as { messages?: ChatMessage[]; [k: string]: unknown }
    const messages = Array.isArray(data.messages) ? data.messages : []

    if (message.clientMsgId) {
      const i = messages.findIndex((m) => m.id === message.clientMsgId)
      if (i !== -1) {
        const next = messages.slice()
        next[i] = { ...message, sentByMe: true, status: 'sent' }
        return { ...data, messages: next }
      }
    }

    if (messages.some((m) => m.id === message.id)) return data
    return { ...data, messages: [...messages, message].slice(-MAX_CACHED_MESSAGES) }
  })
}
```

- [ ] **Step 2: Dequeue on confirmation**

In the `chat:message` handler, after the `appendMessage` call:

```ts
  socket.on('chat:message', (evt: ChatMessageEvent) => {
    const key = keyFor(evt.channel, evt.groupId)
    if (key) appendMessage(key, evt.message)

    // My own message came back confirmed — it lives in the query cache now.
    if (evt.message.clientMsgId) {
      useChatOutboxStore.getState().dequeue(evt.message.clientMsgId)
    }

    // …existing unread-bump logic unchanged…
  })
```

- [ ] **Step 3: Verify — typecheck**

```bash
cd Frontend && npm run validate
```

Expected: clean.

- [ ] **Step 4: Verify — no duplicates (the whole point)**

Send a message online.

Expected: **exactly one** bubble, which flips from the pending clock to `✓`. Local Storage `camply-chat-outbox` returns to an empty `entries` array.

- [ ] **Step 5: Verify — dedupe under retry**

Offline-send one message. Reconnect while throttled to **Slow 3G** so a retry is plausible. Then in `mongosh`:

```js
db.messages.find({ clientMsgId: { $exists: true } }).sort({ createdAt: -1 }).limit(3)
```

Expected: exactly one document per message you sent. Confirm the UI shows one bubble too.

- [ ] **Step 6: Verify — reload mid-pending**

Go offline, send a message, then **reload the app** while still offline.

Expected: the pending bubble is still there (localStorage outbox + `flushOutbox`'s re-insert). Go online — it sends, once.

- [ ] **Step 7: Commit**

```bash
cd Frontend
npx prettier --write --end-of-line auto src/api/realtime/realtimeBridge.ts
git add src/api/realtime/realtimeBridge.ts
git commit -m "fix(chat): reconcile server echoes against pending bubbles

An echo carrying my clientMsgId now replaces the optimistic bubble in place
instead of appending beside it, and dequeues the outbox entry. Without this
every message I send renders twice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Workstream 4 — Offline UI

### Task 6: Connection state, offline banner, pending/failed bubbles

**Files:**
- Create: `Frontend/src/store/useConnectionStore.ts`
- Modify: `Frontend/src/api/realtime/realtimeBridge.ts` (connect/disconnect → store)
- Modify: `Frontend/src/main.tsx` (window online/offline listeners)
- Modify: `Frontend/src/components/participant/chat/Composer.tsx`
- Modify: `Frontend/src/components/participant/chat/MessageBubble.tsx`
- Modify: `Frontend/src/components/participant/chat/MessageList.tsx` (pass `onRetry`)
- Modify: `Frontend/src/i18n/translations.ts` (`ChatStrings` + all three blocks)

**Interfaces:**
- Consumes: `useChatOutboxStore.retry`, `flushOutbox` (Tasks 3–4).
- Produces: `useConnectionStore` with `{ online: boolean, setOnline(v) }`; new i18n keys `chat.offlineBanner`, `chat.pendingSend`, `chat.sendFailed`, `chat.retry`.

- [ ] **Step 1: Create the connection store**

`Frontend/src/store/useConnectionStore.ts`:

```ts
import { create } from 'zustand'

/*
  Are we actually able to reach the server? Connection state, not server data —
  legitimately Zustand. Fed by the socket's connect/disconnect (the real signal:
  navigator.onLine cheerfully reports true on a captive-portal wifi) and by the
  window online/offline events (the fast signal, for immediate UI feedback).
*/
type ConnectionState = {
  online: boolean
  setOnline: (online: boolean) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  setOnline: (online) => set({ online }),
}))
```

- [ ] **Step 2: Feed it from the socket**

`Frontend/src/api/realtime/realtimeBridge.ts` — in the `connect` handler add `useConnectionStore.getState().setOnline(true)`, and register a disconnect handler beside the others:

```ts
  socket.on('disconnect', () => {
    useConnectionStore.getState().setOnline(false)
  })
```

- [ ] **Step 3: Feed it from the browser too**

`Frontend/src/main.tsx`, before `createRoot`:

```ts
// The fast signal — the socket's own connect/disconnect is the authoritative
// one, but these fire instantly so the UI reacts the moment signal drops.
window.addEventListener('online', () => useConnectionStore.getState().setOnline(true))
window.addEventListener('offline', () => useConnectionStore.getState().setOnline(false))
```

- [ ] **Step 4: Add the four strings in all three languages**

`Frontend/src/i18n/translations.ts` — in the `ChatStrings` type, beside `loadError`:

```ts
  offlineBanner: string // shown above the composer while disconnected
  pendingSend: string // aria-label on a queued message
  sendFailed: string // aria-label on a failed message
  retry: string // retry button label
```

Values, in each block:

- `uz`: `offlineBanner: 'Oflayn — internet paydo boʻlgach yuboriladi',` · `pendingSend: 'Yuborilmoqda',` · `sendFailed: 'Yuborilmadi',` · `retry: 'Qayta urinish',`
- `ru`: `offlineBanner: 'Офлайн — отправим, когда появится связь',` · `pendingSend: 'Отправляется',` · `sendFailed: 'Не отправлено',` · `retry: 'Повторить',`
- `en`: `offlineBanner: 'Offline — messages will send when you reconnect',` · `pendingSend: 'Sending',` · `sendFailed: 'Not sent',` · `retry: 'Retry',`

- [ ] **Step 5: The composer stays usable offline**

`Frontend/src/components/participant/chat/Composer.tsx` — do **not** disable the input; that's the whole point. Add a slim banner above it:

```tsx
      {!online && (
        <div className="px-3.5 pb-1 text-center text-[12px] text-muted">{t.chat.offlineBanner}</div>
      )}
```

with `const online = useConnectionStore((s) => s.online)`. Place it directly above the existing input row, inside the composer's outer wrapper.

- [ ] **Step 6: Render the two new statuses**

`Frontend/src/components/participant/chat/MessageBubble.tsx` — it already switches on `message.status` for `✓`/`✓✓`. Add the two cases. Accept a new optional prop `onRetry?: () => void`.

```tsx
  const statusMark =
    message.status === 'pending' ? (
      <span className="opacity-60" aria-label={t.chat.pendingSend}>
        🕘
      </span>
    ) : message.status === 'failed' ? (
      <button
        type="button"
        onClick={onRetry}
        className="text-danger underline underline-offset-2"
        aria-label={t.chat.sendFailed}
      >
        {t.chat.retry}
      </button>
    ) : /* …existing ✓ / ✓✓ logic unchanged… */ null
```

Also dim the whole bubble while pending — add `message.status === 'pending' ? 'opacity-60' : ''` to the bubble's className.

> Read the existing status rendering before editing and preserve its exact markup for `sent`/`read`. Only add branches.

- [ ] **Step 7: Wire retry through the list**

`Frontend/src/components/participant/chat/MessageList.tsx` — pass a handler to each bubble:

```tsx
            onRetry={
              m.status === 'failed' && m.clientMsgId
                ? () => {
                    useChatOutboxStore.getState().retry(m.clientMsgId!)
                    flushOutbox()
                  }
                : undefined
            }
```

with the two imports. Do the same in the organizer thread if it renders `MessageBubble` directly.

- [ ] **Step 8: Verify — typecheck**

```bash
cd Frontend && npm run validate
```

Expected: clean. A missing language key fails the build — that's the guardrail working.

- [ ] **Step 9: Verify — the offline experience end to end**

Go offline.

Expected: the banner appears; the composer still accepts typing; sent messages show dimmed with the clock glyph. Go online: banner clears, bubbles flip to `✓`.

- [ ] **Step 10: Verify — the failure path**

Force a rejection: send from a camp you've been removed from (delete your `Membership` row in Mongo, then send).

Expected: after the attempts are burned, the bubble shows `failed` with a retry affordance. Tapping it re-queues and re-sends.

- [ ] **Step 11: Verify — trilingual + dark mode**

Switch language to UZ, then RU, with the banner visible. Expected: all four strings render, nothing overflows. Toggle dark mode. Expected: banner and both bubble states use theme tokens, readable in both.

- [ ] **Step 12: Commit**

```bash
cd Frontend
npx prettier --write --end-of-line auto src/store/useConnectionStore.ts src/api/realtime/realtimeBridge.ts src/main.tsx src/components/participant/chat/Composer.tsx src/components/participant/chat/MessageBubble.tsx src/components/participant/chat/MessageList.tsx src/i18n/translations.ts
git add -A
git commit -m "feat(chat): offline banner, pending/failed bubbles, manual retry

The composer stays enabled offline — that's the point. Connection state comes
from the socket's connect/disconnect (authoritative; navigator.onLine reports
true on a captive portal) plus the window events (fast). Four new strings in
EN/UZ/RU.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Docs update (do last, in the same effort)

### Task 7: Update both CLAUDE.md files

**Files:**
- Modify: `Frontend/CLAUDE.md`, `Backend/CLAUDE.md`

- [ ] **Step 1: Frontend**

Append to the chat section of `Frontend/CLAUDE.md`:

```markdown
  - **Chat offline (2026-07-27):** the query cache is **persisted to IndexedDB**
    (`api/persister.ts`, `idb-keyval` + `PersistQueryClientProvider`) behind an
    **allowlist** — chat, `myGroup`, `myRole` only. **Location/map data must
    never be persisted** (privacy guardrail, root `CLAUDE.md`); `shouldPersistQuery`
    is the enforcement point. `gcTime` must stay >= `PERSISTED_MAX_AGE` or
    nothing persists. Bump `PERSIST_BUSTER` on any persisted-payload shape
    change. Cleared on logout. Cached history is capped at 200
    (`MAX_CACHED_MESSAGES`); the server still serves latest-50 and there is **no
    pagination** — deliberate, see the spec's non-goals.
    **Sending goes through `useChatOutboxStore`** (Zustand + localStorage — a
    synchronous boot read, unlike the async IndexedDB cache): `enqueueAndEcho`
    queues + renders a `pending` bubble + emits, `flushOutbox` drains oldest-first
    on the socket's `connect`. Idempotency is server-enforced by a
    `crypto.randomUUID()` **`clientMsgId`**; the echo carrying it **replaces** the
    pending bubble in `appendMessage` rather than appending beside it.
    `MessageStatus` is now `pending|failed|sent|read`. Design/plan:
    `docs/superpowers/{specs,plans}/2026-07-27-chat-offline-outbox*.md`.
```

- [ ] **Step 2: Backend**

Append to the *Realtime chat* section of `Backend/CLAUDE.md`:

```markdown
  **Send idempotency (2026-07-27):** `Message.clientMsgId` (optional, client
  UUID) + a **partial** unique index on `{authorId, clientMsgId}`
  (`partialFilterExpression: { clientMsgId: { $exists: true } }`). It must be
  PARTIAL, not sparse — a compound sparse index covers documents having at least
  one indexed field, so every pre-existing message (authorId present,
  clientMsgId absent) would collide under `unique`. `postMessage` returns the
  existing message on a `clientMsgId` hit (and resolves an `E11000` race by
  re-reading), so the frontend outbox can retry safely. A dedupe hit still
  re-broadcasts — clients dedupe by `id`, and the replay is what lets the
  original sender reconcile an echo it missed. `chat:error` echoes `clientMsgId`
  so a client can attribute a failed send. Design/plan:
  `docs/superpowers/{specs,plans}/2026-07-27-chat-offline-outbox*.md`.
```

- [ ] **Step 3: Mirror plan + spec into both repos**

```bash
cd /Users/mn.afridi/Desktop/Camply
cp Frontend/docs/superpowers/plans/2026-07-27-chat-offline-outbox.md Backend/docs/superpowers/plans/
cp Frontend/docs/superpowers/specs/2026-07-27-chat-offline-outbox-design.md Backend/docs/superpowers/specs/
```

- [ ] **Step 4: Commit both**

```bash
cd Frontend && git add CLAUDE.md docs/ && git commit -m "docs: record chat offline cache + outbox

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"

cd ../Backend && git add CLAUDE.md docs/ && git commit -m "docs: record clientMsgId send idempotency

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review (completed during authoring)

**Spec coverage** — every section of `2026-07-27-chat-offline-outbox-design.md` maps to a task:

| Spec item | Task |
|---|---|
| `Message.clientMsgId` + **partial** unique index | 1 (Step 1) |
| `sendMessageSchema` optional `clientMsgId` | 1 (Step 2) |
| `postMessage` dedupe + `E11000` race resolution | 1 (Step 4) |
| Handler passthrough; dedupe hit still re-broadcasts | 1 (Step 5) |
| IndexedDB persister + `idb-keyval` | 2 (Steps 1–2) |
| Allowlist excluding location/map | 2 (Step 2), verified 2 (Step 8) |
| `gcTime` >= `maxAge`; `buster` | 2 (Steps 2–3) |
| `PersistQueryClientProvider` | 2 (Step 4) |
| 200-message cap | 2 (Step 5) |
| Clear on logout | 2 (Step 6) |
| `OutboxEntry` + store + `MAX_SEND_ATTEMPTS` | 3 (Step 2) |
| `MessageStatus` widening + `ChatMessage.clientMsgId` | 3 (Step 1) |
| Optimistic-first `sendText`, both surfaces | 4 (Steps 1–3) |
| Flush on `connect` | 4 (Step 4) |
| `chat:error` attribution (incl. backend echo) | 4 (Step 4) |
| Echo reconciliation + dequeue | 5 |
| `useConnectionStore` | 6 (Steps 1–3) |
| Offline banner, composer stays enabled | 6 (Step 5) |
| pending/failed bubbles + retry | 6 (Steps 6–7) |
| 4 strings EN/UZ/RU | 6 (Step 4) |
| CLAUDE.md | 7 |
| All 9 spec verification items | 1.7–1.8, 2.8–2.11, 4.6–4.7, 5.4–5.6, 6.9–6.11 |

**Placeholder scan** — no TBD/TODO. Every code step carries real code. Three steps say "read the existing code first and preserve it" (4.3 `useOrgChatStore`, 6.6 `MessageBubble`, 6.7 organizer list) — these are edits into code whose exact current shape I did not fully read, so instructing preservation is more honest than inventing markup that would be pasted over working UI.

**Type consistency** — `OutboxEntry` fields match across 3.2, 4.1, and 4.4. `clientMsgId` is the property name in the Mongoose schema (1.1), the Zod schema (1.2), the server DTO (1.3), the socket payload (4.1), and the client type (3.1) — no `clientMessageId`/`clientMsgID` drift. `enqueueAndEcho` returns `string` in 4.1 and is called for effect in 4.2/4.3. `flushOutbox(): void` matches 4.1, 4.4, and 6.7. `clearPersistedCache()` is defined in 2.2 and called in 2.6. `PERSISTED_MAX_AGE` is defined in 2.2 and consumed in 2.3 and 2.4.

**Cross-plan dependency** — this plan requires the single-argument `campKeys.chat(campId)` from `2026-07-27-chat-load-performance.md`. Stated in the header as a hard prerequisite with a `grep` check. Task 4 Step 4 also assumes that plan's Task 4 (reconnect invalidation) already added the `connect`-handler block it appends to; if it hasn't, add the `flushOutbox()` call to the existing handler instead.

**Riskiest step, flagged for the reviewer** — Task 1 Step 7. Partial-vs-sparse is the one mistake here that breaks *all* sending, on existing databases only, with an error message that points at the wrong field. It gets its own verification step with the exact `mongosh` commands and the manual `dropIndex` recovery.
