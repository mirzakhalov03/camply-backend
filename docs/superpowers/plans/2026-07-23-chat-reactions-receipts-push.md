# Chat Liveness — Reactions, Read Receipts, Unread & Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Camply chat live and social — reliable real-time delivery, server-persisted reactions, "seen by anyone" read receipts, a live unread badge, and OS push for absent users — on the Socket.IO transport that already ships.

**Architecture:** Everything rides the two existing seams: the Socket.IO layer (`backend/src/sockets/chat.handlers.ts` ↔ `frontend/src/api/realtime/realtimeBridge.ts`) and the `Message` model / `chatService` projection. New server events `chat:react`, `chat:read`, `chat:unread`; new collections `ChatRead`, `PushSubscription`; reactions embedded on `Message`. Push fans out through a single `notify.service` fed by Socket.IO room presence.

**Tech Stack:** Backend — Express 5, Mongoose 9, Zod 4 (import `z` from `config/zod`), Socket.IO, `web-push` (new dep). Frontend — React 19, React Query, Zustand, `socket.io-client`.

## Global Constraints

- **No test runner** — both CLAUDE.md files forbid it. "Verify" = `npm run typecheck` (or `npm run validate`) **plus** the manual runtime check each task names. Never add a test file or test dep.
- **Backend layering:** `routes → controllers → services → models`. Controllers are thin, **no try/catch** (Express 5 forwards async throws). Business/data logic in services. Throw `new HttpError(status, message)`.
- **Backend validation:** every input gets a Zod schema in `validators/`, applied via `validate({ body })`. **Import `z` from `../config/zod`**, never `'zod'`.
- **Backend env:** all config through `config/env.ts` (Zod-validated at boot). Never read `process.env` elsewhere. New push env vars are **optional** so boot survives before keys exist.
- **Backend docs:** every new endpoint gets a `registry.registerPath(...)` in `docs/openapi.ts`, reusing validator schemas.
- **Frontend data philosophy:** server data → React Query only, never mirrored into Zustand. Realtime writes **into** the query cache. Zustand only for client-owned UI state.
- **Frontend imports:** use `@/` alias in files you touch; `import type { … }` for type-only imports (`verbatimModuleSyntax` is on).
- **Trilingual:** no hard-coded user-facing copy — every string ships **UZ / RU / EN**. Push copy is rendered server-side per the recipient's `User.language` (default `'uz'`).
- **Frozen push contract:** `POST /api/push/subscribe { subscription } → 201` (idempotent upsert on endpoint); `DELETE /api/push/subscribe { endpoint } → 204`. Env `VITE_VAPID_PUBLIC_KEY` (frontend), `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` (backend). SW payload `{ title, body, url, tag? }`.
- **Server is the authority.** Socket rooms are server-derived; every socket event re-checks entitlement exactly as `chat:send` does. A client-sent `groupId` is never trusted.
- **Two repos:** `backend/` and `frontend/` are separate git repos; root is not a repo. Commit in the repo you changed. Mirror this plan file's edits into both `docs/superpowers/plans/`.
- **Prettier:** no semicolons, single quotes, trailing commas, width 100. Format only files you touch: `npx prettier --write --end-of-line auto <files>`.

---

## Workstream 0 — Fix live delivery ("needs a refresh")

### Task 0: Diagnose and fix real-time message delivery

The wiring reads correct, so this is reproduce-then-fix. The deliverable is: a message sent in one session appears in another with **no refresh**, on group **and** organizers channels. We also harden the bridge for reconnects (valuable regardless of the specific cause).

**Files:**
- Modify: `frontend/src/api/realtime/realtimeBridge.ts`
- Reference: `frontend/src/components/participant/ParticipantDashboard.tsx:42-46`, `frontend/vite.config.ts:52-56`, `backend/src/sockets/chat.handlers.ts`

- [ ] **Step 1: Reproduce with two sessions**

Start both servers (`cd backend && npm run dev`; `cd frontend && npm run dev`). Open the app in two different browsers (or a normal + incognito window) logged in as two participants **in the same group**. Send from A; confirm B does **not** update until reload. This is the baseline.

- [ ] **Step 2: Instrument the bridge**

Add temporary logs to `frontend/src/api/realtime/realtimeBridge.ts` — in `connectRealtime`'s `connect` handler log `'[rt] connected, joining', campId`; in the `chat:message` handler log `'[rt] message', evt.channel, evt.groupId, evt.message.id`; inside `appendMessage` log the `key`. In the browser console of session B, watch which logs fire when A sends.

Diagnose by which log is missing:
- **No `[rt] connected`** → the socket never connects. Check the Network tab for the `/socket.io` request: 101 Switching Protocols = ok; 404/400 = the Vite `/socket.io` proxy (`vite.config.ts`) or the handshake cookie is the problem. Confirm `withCredentials` sends `camply_sid`.
- **`connected` but no `[rt] message`** → B isn't in the room, or the event isn't broadcast. Add a server log in `backend/src/sockets/chat.handlers.ts` `chat:connectCamp` after `socket.join(...)` (`'[rt] joined', groupRoom(...)`) and in `chat:send` before the emit. Confirm both sockets joined the **same** room string.
- **`[rt] message` fires but UI doesn't change** → key mismatch. Log the read key in `ChatScreen` (`campKeys.chat(campId, groupId)`) and compare to the append key. This is the StrictMode-or-key class of bug.

- [ ] **Step 3: Apply the fix — harden the bridge**

Replace `frontend/src/api/realtime/realtimeBridge.ts` with the hardened version below. It (a) makes StrictMode's mount→cleanup→mount safe by tolerating a synchronous disconnect of a just-created socket, (b) re-emits `chat:connectCamp` on every `connect` (covers reconnects), and (c) removes the stale-closure risk by reading `campId` off a ref rather than the module var inside handlers. Keep the diagnostic logs until Step 4 passes, then delete them.

```ts
import { io, type Socket } from 'socket.io-client'
import { queryClient } from '@/api/queryClient'
import { campKeys } from '../queryKeys'
import type { ChatMessage } from '@/lib/chat'

/*
  The realtime BRIDGE — the ONE socket, routing server events into the SAME React
  Query cache the UI reads. Auth rides the httpOnly camply_sid cookie on the
  handshake (same-origin via the Vite /socket.io proxy). Sending is the store
  emitting chat:send via getSocket(); the server's chat:message echo lands here.
*/

type ChatMessageEvent = {
  channel: 'group' | 'organizers'
  groupId: string | null
  message: ChatMessage
}

const WS_URL = import.meta.env.VITE_WS_URL as string | undefined

let socket: Socket | null = null
let currentCampId: string | null = null

function keyFor(channel: 'group' | 'organizers', groupId: string | null) {
  if (!currentCampId) return null
  return channel === 'group' && groupId
    ? campKeys.chat(currentCampId, groupId)
    : campKeys.chatOrganizers(currentCampId)
}

/** Append a message into a room's cached history, deduped by id. */
function appendMessage(key: readonly unknown[], message: ChatMessage) {
  queryClient.setQueryData(key, (prev: unknown) => {
    const data = (prev ?? { messages: [] }) as { messages?: ChatMessage[]; [k: string]: unknown }
    const messages = Array.isArray(data.messages) ? data.messages : []
    if (messages.some((m) => m.id === message.id)) return data
    return { ...data, messages: [...messages, message] }
  })
}

export function connectRealtime(campId: string) {
  // Already connected to this camp — nothing to do (StrictMode-safe: a second mount
  // with the same campId is a no-op rather than a churn of the live socket).
  if (socket && currentCampId === campId) return
  if (socket) disconnectRealtime()
  currentCampId = campId

  socket = io(WS_URL ?? '', { withCredentials: true })

  // Fires on first connect AND every reconnect — re-join the room each time so a
  // dropped connection self-heals without a page refresh.
  socket.on('connect', () => {
    socket?.emit('chat:connectCamp', { campId })
  })

  socket.on('chat:message', (evt: ChatMessageEvent) => {
    const key = keyFor(evt.channel, evt.groupId)
    if (key) appendMessage(key, evt.message)
  })
}

export function disconnectRealtime() {
  socket?.disconnect()
  socket = null
  currentCampId = null
}

/** The live socket, so the chat stores can emit chat:send. Null until connected. */
export function getSocket(): Socket | null {
  return socket
}
```

- [ ] **Step 4: Verify delivery, then remove logs**

Repeat Step 1 with the fix. A message from A must appear in B with no refresh, both channels. Kill and restart the backend mid-session: the socket reconnects and re-joins (the `connect` handler re-fires). Delete the temporary logs. Run `cd frontend && npm run typecheck`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd frontend
npx prettier --write --end-of-line auto src/api/realtime/realtimeBridge.ts
git add src/api/realtime/realtimeBridge.ts
git commit -m "fix(chat): reliable live delivery — StrictMode-safe socket + reconnect re-join

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Workstream 1 — Reactions (server-real)

### Task 1: Backend — reactions on the Message model + projection + toggle

**Files:**
- Modify: `backend/src/models/message.model.ts`
- Modify: `backend/src/services/chat.services.ts`

**Interfaces:**
- Produces: `chatService.toggleReaction({ messageId, userId, emoji }) → Promise<{ emoji: string; count: number }[]>`
- Produces: `chatService.toChatMessage(doc, viewerId?)` — reactions aggregate `mine` against `viewerId`.
- Produces: history/room projections gain `reactions: { emoji, count, mine }[]` per message.

- [ ] **Step 1: Add the reactions subdocument to the Message schema**

In `backend/src/models/message.model.ts`, add a reactions array to `messageSchema` (after `text`):

```ts
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
    // Embedded reactions — bounded per message (a handful of emojis). One {userId,
    // emoji} pair per reactor per emoji; toggling removes it. No _id on subdocs.
    reactions: {
      type: [
        new Schema(
          {
            userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            emoji: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
```

- [ ] **Step 2: Teach `toChatMessage` to aggregate reactions per viewer**

In `backend/src/services/chat.services.ts`, update the `ChatMessage` type and `toChatMessage`. Add a `MessageReaction` type and change the signature to take an optional `viewerId`:

```ts
export type MessageReaction = { emoji: string; count: number; mine: boolean }

export type ChatMessage = {
  id: string
  authorId: string
  kind: 'text'
  text: string
  time: string // HH:MM
  createdAt: string // ISO — the client can re-derive `time` and ordering
  reactions: MessageReaction[]
}
```

```ts
function toChatMessage(doc: Message, viewerId?: string): ChatMessage {
  const createdAt = (doc as unknown as { createdAt: Date }).createdAt
  return {
    id: String(doc._id),
    authorId: String(doc.authorId),
    kind: 'text',
    text: doc.text,
    time: hhmm(createdAt),
    createdAt: createdAt.toISOString(),
    reactions: aggregateReactions(doc.reactions ?? [], viewerId),
  }
}

// Group the flat {userId, emoji} pairs into { emoji, count, mine } chips.
function aggregateReactions(
  raw: { userId: unknown; emoji: string }[],
  viewerId?: string,
): MessageReaction[] {
  const byEmoji = new Map<string, { count: number; mine: boolean }>()
  for (const r of raw) {
    const entry = byEmoji.get(r.emoji) ?? { count: 0, mine: false }
    entry.count += 1
    if (viewerId && String(r.userId) === viewerId) entry.mine = true
    byEmoji.set(r.emoji, entry)
  }
  return [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v }))
}
```

- [ ] **Step 3: Thread `viewerId` through history + add `toggleReaction`**

In `chatService`, update `history` to accept + pass `viewerId`, and the two `list*History` helpers to take + forward it. Add `toggleReaction`:

```ts
  // Latest N for an exact room, oldest→newest (the client appends).
  history: async (
    campId: Types.ObjectId,
    channel: MessageChannel,
    groupId: Types.ObjectId | null,
    viewerId?: string,
  ) => {
    const docs = await MessageModel.find({ campId, channel, groupId })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
    return docs.reverse().map((d) => toChatMessage(d, viewerId))
  },
```

```ts
  listGroupHistory: async (campId: Types.ObjectId, groupId: Types.ObjectId, viewerId?: string) => ({
    groupId: String(groupId),
    members: await chatService.groupMembers(campId, groupId),
    messages: await chatService.history(campId, 'group', groupId, viewerId),
  }),

  listOrganizersHistory: async (campId: Types.ObjectId, viewerId?: string) => ({
    members: await chatService.organizerMembers(campId),
    messages: await chatService.history(campId, 'organizers', null, viewerId),
  }),
```

```ts
  // Toggle one {user, emoji} pair on a message; returns the message's { emoji, count }
  // aggregate (identities are never broadcast — mine is computed client-side).
  toggleReaction: async (input: {
    messageId: Types.ObjectId
    userId: Types.ObjectId
    emoji: string
  }): Promise<{ emoji: string; count: number }[]> => {
    const doc = await MessageModel.findById(input.messageId)
    if (!doc) throw new Error('message_not_found')
    const has = (doc.reactions ?? []).some(
      (r) => String(r.userId) === String(input.userId) && r.emoji === input.emoji,
    )
    if (has) {
      await MessageModel.updateOne(
        { _id: input.messageId },
        { $pull: { reactions: { userId: input.userId, emoji: input.emoji } } },
      )
    } else {
      await MessageModel.updateOne(
        { _id: input.messageId },
        { $push: { reactions: { userId: input.userId, emoji: input.emoji } } },
      )
    }
    const fresh = await MessageModel.findById(input.messageId)
    const counts = new Map<string, number>()
    for (const r of fresh?.reactions ?? []) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1)
    return [...counts.entries()].map(([emoji, count]) => ({ emoji, count }))
  },
```

- [ ] **Step 4: Pass `viewerId` at the two REST call sites**

In `backend/src/controllers/chat.controllers.ts`, pass the caller id (`req.auth!.user` id) into the history helpers:

```ts
export const getGroupMessages: RequestHandler = async (req, res) => {
  const campId = req.camp!._id
  const groupId = req.membership?.groupId
  const viewerId = String(req.auth!.user._id)
  if (!groupId) {
    res.json({ groupId: null, members: [], messages: [] })
    return
  }
  res.json(await chatService.listGroupHistory(campId, groupId as Types.ObjectId, viewerId))
}

export const getOrganizerMessages: RequestHandler = async (req, res) => {
  res.json(await chatService.listOrganizersHistory(req.camp!._id, String(req.auth!.user._id)))
}
```

> If `req.auth!.user` exposes the id as `.id` rather than `._id`, use that — check `backend/src/types/express.d.ts` for the augmented `req.auth` shape and match it.

- [ ] **Step 5: Verify + commit**

Run `cd backend && npm run typecheck`. Expected: no errors. Then a quick manual REST check — with the dev server running and a valid `camply_sid` cookie, `GET /api/camps/:id/chat/group/messages` should now return each message with a `reactions: []` array. Commit:

```bash
cd backend
npx prettier --write --end-of-line auto src/models/message.model.ts src/services/chat.services.ts src/controllers/chat.controllers.ts
git add src/models/message.model.ts src/services/chat.services.ts src/controllers/chat.controllers.ts
git commit -m "feat(chat): embed reactions on messages + per-viewer projection + toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 2: Backend — `chat:react` socket handler

**Files:**
- Modify: `backend/src/validators/chat.validators.ts`
- Modify: `backend/src/sockets/chat.handlers.ts`

**Interfaces:**
- Consumes: `chatService.toggleReaction` (Task 1).
- Produces: socket event in `chat:react { campId, channel, messageId, emoji }`; broadcast out `chat:reaction { channel, groupId, messageId, reactions: { emoji, count }[] }`.

- [ ] **Step 1: Add the react payload schema**

In `backend/src/validators/chat.validators.ts`, add:

```ts
// Socket chat:react payload. Same channel model as chat:send; groupId is re-derived
// server-side. A small allowlist keeps arbitrary strings out of the reactions store.
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '👏'] as const

export const reactMessageSchema = z.object({
  campId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid campId'),
  channel: z.enum(MESSAGE_CHANNELS),
  messageId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid messageId'),
  emoji: z.enum(REACTION_EMOJIS),
})

export type ReactMessageInput = z.infer<typeof reactMessageSchema>
```

- [ ] **Step 2: Add a room-resolution helper and the `chat:react` handler**

In `backend/src/sockets/chat.handlers.ts`, add the import and a small helper that maps a validated `{campId, channel}` to the room + groupId the caller is entitled to (reuses the same `entitlement` logic `chat:send` uses), then the handler. Add near the top:

```ts
import { reactMessageSchema } from '../validators/chat.validators'
```

Add this handler inside `registerChatHandlers`, after the `chat:send` handler:

```ts
  socket.on('chat:react', async (payload: unknown) => {
    const parsed = reactMessageSchema.safeParse(payload)
    if (!parsed.success) return
    const { campId, channel, messageId, emoji } = parsed.data
    const entitlement = socket.data.byCamp?.get(campId)
    if (!entitlement) return

    let room: string
    let groupId: string | null = null
    if (channel === 'organizers') {
      if (!entitlement.canOrganizers) return
      room = orgRoom(campId)
    } else {
      if (!entitlement.groupId) return
      groupId = entitlement.groupId
      room = groupRoom(campId, groupId)
    }

    const reactions = await chatService.toggleReaction({
      messageId: new Types.ObjectId(messageId),
      userId: new Types.ObjectId(user.id),
      emoji,
    })
    io.to(room).emit('chat:reaction', { channel, groupId, messageId, reactions })
  })
```

- [ ] **Step 3: Verify + commit**

Run `cd backend && npm run typecheck`. Expected: no errors. Manual check comes with Task 3 (needs the client). Commit:

```bash
cd backend
npx prettier --write --end-of-line auto src/validators/chat.validators.ts src/sockets/chat.handlers.ts
git add src/validators/chat.validators.ts src/sockets/chat.handlers.ts
git commit -m "feat(chat): chat:react socket handler broadcasting reaction counts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 3: Frontend — real reactions (emit + reconcile)

**Files:**
- Modify: `frontend/src/store/useChatStore.ts`
- Modify: `frontend/src/store/useOrgChatStore.ts` (mirror, if it holds a reaction overlay — check first)
- Modify: `frontend/src/api/realtime/realtimeBridge.ts`
- Modify: `frontend/src/lib/chat.ts` (make `reactions` non-optional to match the server)

**Interfaces:**
- Consumes: server events `chat:reaction { channel, groupId, messageId, reactions: { emoji, count }[] }`.
- Produces: `useChatStore.toggleReaction(campId, channel, messageId, emoji, current)` emits `chat:react` and optimistically updates the cache.

- [ ] **Step 1: Handle `chat:reaction` in the bridge**

In `frontend/src/api/realtime/realtimeBridge.ts`, add a reaction event type and a handler that updates the target message's `reactions` in cache — merging server **counts** while preserving each client's local `mine` flags:

```ts
import type { ChatMessage, MessageReaction } from '@/lib/chat'

type ChatReactionEvent = {
  channel: 'group' | 'organizers'
  groupId: string | null
  messageId: string
  reactions: { emoji: string; count: number }[]
}
```

```ts
/** Replace a message's reaction counts from the server, preserving my local `mine`. */
function applyReaction(key: readonly unknown[], evt: ChatReactionEvent) {
  queryClient.setQueryData(key, (prev: unknown) => {
    const data = prev as { messages?: ChatMessage[] } | undefined
    if (!data?.messages) return data
    const messages = data.messages.map((m) => {
      if (m.id !== evt.messageId) return m
      const prevMine = new Set((m.reactions ?? []).filter((r) => r.mine).map((r) => r.emoji))
      const reactions: MessageReaction[] = evt.reactions.map((r) => ({
        emoji: r.emoji,
        count: r.count,
        mine: prevMine.has(r.emoji),
      }))
      return { ...m, reactions }
    })
    return { ...data, messages }
  })
}
```

Register it inside `connectRealtime` next to the `chat:message` handler:

```ts
  socket.on('chat:reaction', (evt: ChatReactionEvent) => {
    const key = keyFor(evt.channel, evt.groupId)
    if (key) applyReaction(key, evt)
  })
```

> `useAuthStore` import is unused here if you compute `mine` purely from the previous cache (as above) — drop the import unless a later step needs it, to satisfy `noUnusedLocals`.

- [ ] **Step 2: Make `reactions` authoritative in the chat type**

In `frontend/src/lib/chat.ts`, change `reactions?: MessageReaction[]` to `reactions: MessageReaction[]` on `ChatMessage` (the server now always sends it). Leave `MessageReaction` as-is (`{ emoji, count, mine }`).

- [ ] **Step 3: Rewrite `useChatStore.toggleReaction` to emit + optimistically update**

Replace `frontend/src/store/useChatStore.ts` — drop `reactionOverrides` entirely; `toggleReaction` now emits `chat:react` and optimistically flips the cached message so the tap feels instant (the server echo reconciles counts):

```ts
import { create } from 'zustand'
import { getSocket } from '@/api/realtime/realtimeBridge'
import { queryClient } from '@/api/queryClient'
import { campKeys } from '@/api/queryKeys'
import type { ChatMessage, MessageReaction } from '@/lib/chat'

/*
  CLIENT actions for the participant group chat. Message + reaction state are SERVER
  truth in the React Query cache (see realtimeBridge); this store only holds the
  emit helpers. Reactions: emit chat:react, optimistically flip the cached message,
  and let the chat:reaction echo reconcile the authoritative counts.
*/
type ChatState = {
  sendText: (campId: string, groupId: string, text: string) => void
  toggleReaction: (
    campId: string,
    channel: 'group' | 'organizers',
    groupId: string | null,
    messageId: string,
    emoji: string,
  ) => void
}

/** Local optimistic toggle of `current` for my tap (mirrors the server's toggle). */
function optimistic(current: MessageReaction[], emoji: string): MessageReaction[] {
  const existing = current.find((r) => r.emoji === emoji)
  if (!existing) return [...current, { emoji, count: 1, mine: true }]
  if (existing.mine) {
    const count = existing.count - 1
    return count <= 0
      ? current.filter((r) => r.emoji !== emoji)
      : current.map((r) => (r.emoji === emoji ? { ...r, count, mine: false } : r))
  }
  return current.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r))
}

export const useChatStore = create<ChatState>(() => ({
  sendText: (campId, _groupId, text) => {
    const clean = text.trim()
    if (!clean) return
    getSocket()?.emit('chat:send', { campId, channel: 'group', text: clean })
  },

  // The caller passes the tapped `emoji`; the message's current reactions are read
  // from the cache (the source of truth).
  toggleReaction: (campId, channel, groupId, messageId, emoji) => {
    // Optimistic cache update so the chip responds immediately; the chat:reaction
    // echo reconciles the authoritative counts.
    const key =
      channel === 'group' && groupId
        ? campKeys.chat(campId, groupId)
        : campKeys.chatOrganizers(campId)
    queryClient.setQueryData(key, (prev: unknown) => {
      const data = prev as { messages?: ChatMessage[] } | undefined
      if (!data?.messages) return data
      return {
        ...data,
        messages: data.messages.map((m) =>
          m.id === messageId ? { ...m, reactions: optimistic(m.reactions ?? [], emoji) } : m,
        ),
      }
    })
    getSocket()?.emit('chat:react', { campId, channel, messageId, emoji })
  },
}))
```

- [ ] **Step 4: Update the call site in `MessageList`**

In `frontend/src/components/participant/chat/MessageList.tsx`, the reactions now come straight off the message (server truth) — remove the `reactionOverrides` lookup and pass the new toggle signature. Replace the map body:

```tsx
      {all.map((m) => {
        const author = byId.get(m.authorId)
        const reactions = m.reactions ?? []
        return (
          <MessageBubble
            key={m.id}
            message={m}
            author={author}
            onAuthorTap={author ? () => onMemberTap(author) : undefined}
            reactions={reactions}
            onToggleReaction={(emoji) => toggleReaction(campId, 'group', groupId, m.id, emoji)}
            onReply={() => onReply(m)}
          />
        )
      })}
```

`MessageList` now needs `campId` and `groupId` props (thread them from `ChatScreen`, which already has both) and `toggleReaction` from `useChatStore`. Remove the `reactionOverrides` selector. Update the `Props` type and the `ChatScreen` render of `<MessageList … campId={campId} groupId={groupId} />`.

- [ ] **Step 5: Mirror for the organizers channel**

Check `frontend/src/store/useOrgChatStore.ts` and `frontend/src/components/organizer/chat/OrgChatScreen.tsx`. If org chat has its own reaction overlay, apply the identical treatment: reactions off the message, `toggleReaction(campId, channel, groupId, messageId, emoji)` where `channel` is `'organizers'` (groupId `null`) for the organizers thread and `'group'` for the coordinator's group thread. Reuse `useChatStore.toggleReaction` — do not duplicate the emit logic.

- [ ] **Step 6: Verify end-to-end + commit**

Run `cd frontend && npm run typecheck`. Expected: no errors. Two sessions, same group: A taps 👍 on a message → A's chip shows filled (`mine`) with count 1 instantly; B sees count 1 with an unfilled chip, live; both survive a refresh (server truth); A taps 👍 again → count drops to 0 and the chip disappears for both.

```bash
cd frontend
npx prettier --write --end-of-line auto src/store/useChatStore.ts src/store/useOrgChatStore.ts src/api/realtime/realtimeBridge.ts src/lib/chat.ts src/components/participant/chat/MessageList.tsx src/components/participant/chat/ChatScreen.tsx src/components/organizer/chat/OrgChatScreen.tsx
git add -A
git commit -m "feat(chat): real reactions — emit chat:react, reconcile broadcast counts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Workstream 2 — Read receipts ("seen by anyone")

### Task 4: Backend — `ChatRead` model + service

**Files:**
- Create: `backend/src/models/chatRead.model.ts`
- Create: `backend/src/services/chatRead.services.ts`

**Interfaces:**
- Produces: `chatReadService.mark({ campId, channel, groupId, userId }) → Promise<Date>` (the new lastReadAt).
- Produces: `chatReadService.othersLastReadAt({ campId, channel, groupId, exceptUserId }) → Promise<Date | null>`.
- Produces: `chatReadService.unreadCounts(userId, rooms: { channel, groupId }[]) → Promise<{ channel, groupId, count }[]>`.

- [ ] **Step 1: Create the model**

`backend/src/models/chatRead.model.ts`:

```ts
import { Schema, model, Types, type InferSchemaType } from 'mongoose'
import { MESSAGE_CHANNELS } from './message.model'

/*
  One last-read marker per member per room. Powers both the double-tick ("seen by
  anyone" = any OTHER member's lastReadAt ≥ a message) and the unread badge (messages
  after MY lastReadAt). groupId is null for the organizers channel.
*/
const chatReadSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true },
    channel: { type: String, enum: MESSAGE_CHANNELS, required: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lastReadAt: { type: Date, required: true },
  },
  { timestamps: true },
)

// One marker per {room, user}; also the query shape for othersLastReadAt.
chatReadSchema.index({ campId: 1, channel: 1, groupId: 1, userId: 1 }, { unique: true })

export type ChatRead = InferSchemaType<typeof chatReadSchema> & { _id: Types.ObjectId }
export const ChatReadModel = model('ChatRead', chatReadSchema)
```

- [ ] **Step 2: Create the service**

`backend/src/services/chatRead.services.ts`:

```ts
import { Types } from 'mongoose'
import { ChatReadModel } from '../models/chatRead.model'
import { MessageModel, type MessageChannel } from '../models/message.model'

type Room = { campId: Types.ObjectId; channel: MessageChannel; groupId: Types.ObjectId | null }

export const chatReadService = {
  // Upsert this member's lastReadAt = now. Returns the timestamp for broadcasting.
  mark: async (room: Room & { userId: Types.ObjectId }): Promise<Date> => {
    const now = new Date()
    await ChatReadModel.updateOne(
      { campId: room.campId, channel: room.channel, groupId: room.groupId, userId: room.userId },
      { $set: { lastReadAt: now } },
      { upsert: true },
    )
    return now
  },

  // Max lastReadAt among members OTHER than exceptUserId — the "seen by anyone" seed.
  othersLastReadAt: async (
    room: Room & { exceptUserId: Types.ObjectId },
  ): Promise<Date | null> => {
    const rows = await ChatReadModel.find({
      campId: room.campId,
      channel: room.channel,
      groupId: room.groupId,
      userId: { $ne: room.exceptUserId },
    })
      .sort({ lastReadAt: -1 })
      .limit(1)
    return rows[0]?.lastReadAt ?? null
  },

  // For each room, count messages authored by others after MY lastReadAt.
  unreadCounts: async (
    userId: Types.ObjectId,
    rooms: { campId: Types.ObjectId; channel: MessageChannel; groupId: Types.ObjectId | null }[],
  ): Promise<{ channel: MessageChannel; groupId: string | null; count: number }[]> => {
    const out: { channel: MessageChannel; groupId: string | null; count: number }[] = []
    for (const r of rooms) {
      const mark = await ChatReadModel.findOne({
        campId: r.campId,
        channel: r.channel,
        groupId: r.groupId,
        userId,
      })
      const after = mark?.lastReadAt ?? new Date(0)
      const count = await MessageModel.countDocuments({
        campId: r.campId,
        channel: r.channel,
        groupId: r.groupId,
        authorId: { $ne: userId },
        createdAt: { $gt: after },
      })
      out.push({ channel: r.channel, groupId: r.groupId ? String(r.groupId) : null, count })
    }
    return out
  },
}
```

- [ ] **Step 3: Verify + commit**

Run `cd backend && npm run typecheck`. Expected: no errors. Commit:

```bash
cd backend
npx prettier --write --end-of-line auto src/models/chatRead.model.ts src/services/chatRead.services.ts
git add src/models/chatRead.model.ts src/services/chatRead.services.ts
git commit -m "feat(chat): ChatRead model + service (mark, othersLastReadAt, unreadCounts)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 5: Backend — `chat:read` handler, history seed, `chat:unread` seed

**Files:**
- Modify: `backend/src/validators/chat.validators.ts`
- Modify: `backend/src/sockets/chat.handlers.ts`
- Modify: `backend/src/services/chat.services.ts` (add `othersLastReadAt` to history payloads)
- Modify: `backend/src/controllers/chat.controllers.ts`

**Interfaces:**
- Consumes: `chatReadService` (Task 4).
- Produces: socket in `chat:read { campId, channel }`; out `chat:read { channel, groupId, userId, lastReadAt }`; out `chat:unread { rooms: { channel, groupId, count }[] }` (to the joining socket).
- Produces: REST history payloads gain `othersLastReadAt: string | null`.

- [ ] **Step 1: Add the read payload schema**

In `backend/src/validators/chat.validators.ts`:

```ts
// Socket chat:read payload — "I've read this room up to now". groupId re-derived.
export const readMessagesSchema = z.object({
  campId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid campId'),
  channel: z.enum(MESSAGE_CHANNELS),
})

export type ReadMessagesInput = z.infer<typeof readMessagesSchema>
```

- [ ] **Step 2: Add `othersLastReadAt` to the REST history helpers**

In `backend/src/services/chat.services.ts`, import the read service and enrich both history helpers. Add at top:

```ts
import { chatReadService } from './chatRead.services'
```

Update the helpers to include the seed (the requester is `viewerId`):

```ts
  listGroupHistory: async (campId: Types.ObjectId, groupId: Types.ObjectId, viewerId?: string) => ({
    groupId: String(groupId),
    members: await chatService.groupMembers(campId, groupId),
    messages: await chatService.history(campId, 'group', groupId, viewerId),
    othersLastReadAt: viewerId
      ? (
          await chatReadService.othersLastReadAt({
            campId,
            channel: 'group',
            groupId,
            exceptUserId: new Types.ObjectId(viewerId),
          })
        )?.toISOString() ?? null
      : null,
  }),

  listOrganizersHistory: async (campId: Types.ObjectId, viewerId?: string) => ({
    members: await chatService.organizerMembers(campId),
    messages: await chatService.history(campId, 'organizers', null, viewerId),
    othersLastReadAt: viewerId
      ? (
          await chatReadService.othersLastReadAt({
            campId,
            channel: 'organizers',
            groupId: null,
            exceptUserId: new Types.ObjectId(viewerId),
          })
        )?.toISOString() ?? null
      : null,
  }),
```

- [ ] **Step 3: Add the `chat:read` handler and the `chat:unread` seed**

In `backend/src/sockets/chat.handlers.ts`, import the read service and the schema:

```ts
import { readMessagesSchema } from '../validators/chat.validators'
import { chatReadService } from '../services/chatRead.services'
```

Add the `chat:read` handler after `chat:react`:

```ts
  socket.on('chat:read', async (payload: unknown) => {
    const parsed = readMessagesSchema.safeParse(payload)
    if (!parsed.success) return
    const { campId, channel } = parsed.data
    const entitlement = socket.data.byCamp?.get(campId)
    if (!entitlement) return

    let room: string
    let groupId: Types.ObjectId | null = null
    if (channel === 'organizers') {
      if (!entitlement.canOrganizers) return
      room = orgRoom(campId)
    } else {
      if (!entitlement.groupId) return
      groupId = new Types.ObjectId(entitlement.groupId)
      room = groupRoom(campId, entitlement.groupId)
    }

    const lastReadAt = await chatReadService.mark({
      campId: new Types.ObjectId(campId),
      channel,
      groupId,
      userId: new Types.ObjectId(user.id),
    })
    io.to(room).emit('chat:read', {
      channel,
      groupId: groupId ? String(groupId) : null,
      userId: user.id,
      lastReadAt: lastReadAt.toISOString(),
    })
  })
```

At the **end** of the `chat:connectCamp` handler (after the presence emits), seed unread counts to just this socket:

```ts
    // Seed the unread badge for this socket: messages after my lastReadAt per room.
    const rooms: { campId: Types.ObjectId; channel: 'group' | 'organizers'; groupId: Types.ObjectId | null }[] = []
    if (groupId) rooms.push({ campId: camp._id, channel: 'group', groupId: new Types.ObjectId(groupId) })
    if (canOrganizers) rooms.push({ campId: camp._id, channel: 'organizers', groupId: null })
    if (rooms.length) {
      const counts = await chatReadService.unreadCounts(new Types.ObjectId(user.id), rooms)
      socket.emit('chat:unread', { rooms: counts })
    }
```

- [ ] **Step 4: Verify + commit**

Run `cd backend && npm run typecheck`. Expected: no errors. Manual: `GET /api/camps/:id/chat/group/messages` now returns `othersLastReadAt` (null until someone reads). Commit:

```bash
cd backend
npx prettier --write --end-of-line auto src/validators/chat.validators.ts src/sockets/chat.handlers.ts src/services/chat.services.ts src/controllers/chat.controllers.ts
git add src/validators/chat.validators.ts src/sockets/chat.handlers.ts src/services/chat.services.ts src/controllers/chat.controllers.ts
git commit -m "feat(chat): chat:read + chat:unread seed + othersLastReadAt in history

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 6: Frontend — double-tick ticks + emit reads

**Files:**
- Modify: `frontend/src/api/services/chat.service.ts` (add `othersLastReadAt` to the history types)
- Modify: `frontend/src/api/realtime/realtimeBridge.ts` (handle `chat:read`)
- Modify: `frontend/src/components/participant/chat/ChatScreen.tsx` (derive `status`, emit read)
- Modify: `frontend/src/components/organizer/chat/OrgChatScreen.tsx` (same)

**Interfaces:**
- Consumes: `chat:read { channel, groupId, userId, lastReadAt }`; history `othersLastReadAt`.
- Produces: `getSocket()?.emit('chat:read', { campId, channel })` on thread open + on new inbound messages.

- [ ] **Step 1: Add `othersLastReadAt` to the history types**

In `frontend/src/api/services/chat.service.ts`, add the field to both payload types:

```ts
export type GroupHistory = {
  groupId: string | null
  members: ChatMember[]
  messages: ChatMessage[]
  othersLastReadAt: string | null
}
export type OrgHistory = {
  members: ChatMember[]
  messages: ChatMessage[]
  othersLastReadAt: string | null
}
```

- [ ] **Step 2: Handle `chat:read` in the bridge**

In `frontend/src/api/realtime/realtimeBridge.ts`, add the `useAuthStore` import (first use is here), the event type, and a handler that raises `othersLastReadAt` on the room's cached history (only for OTHER users' reads):

```ts
import { useAuthStore } from '@/store/useAuthStore'

type ChatReadEvent = {
  channel: 'group' | 'organizers'
  groupId: string | null
  userId: string
  lastReadAt: string
}
```

```ts
  socket.on('chat:read', (evt: ChatReadEvent) => {
    const myId = useAuthStore.getState().user?.id
    if (evt.userId === myId) return // my own read never advances "others"
    const key = keyFor(evt.channel, evt.groupId)
    if (!key) return
    queryClient.setQueryData(key, (prev: unknown) => {
      const data = prev as { othersLastReadAt?: string | null } | undefined
      if (!data) return data
      const current = data.othersLastReadAt ?? ''
      return evt.lastReadAt > current ? { ...data, othersLastReadAt: evt.lastReadAt } : data
    })
  })
```

(The `useAuthStore` import added above is used here; Task 7 reuses it in the `chat:message` handler.)

- [ ] **Step 3: Derive `status` and emit reads in `ChatScreen`**

In `frontend/src/components/participant/chat/ChatScreen.tsx`, compute each of my messages' `status` from `othersLastReadAt`, and emit `chat:read` on mount and whenever the message count grows. Update the `serverMessages` memo and add the effect:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { getSocket } from '@/api/realtime/realtimeBridge'
```

```tsx
  const othersLastReadAt = data?.othersLastReadAt ?? null

  // Server messages carry authorId; derive sentByMe and (for mine) read-status.
  const serverMessages = useMemo(
    () =>
      (data?.messages ?? []).map((m) => {
        const sentByMe = m.authorId === myId
        const status =
          sentByMe && othersLastReadAt && othersLastReadAt >= m.createdAt ? 'read' : sentByMe ? 'sent' : undefined
        return { ...m, sentByMe, status } as typeof m
      }),
    [data?.messages, myId, othersLastReadAt],
  )

  // Opening the thread — and each new inbound message while it's open — marks read.
  useEffect(() => {
    if (!campId) return
    getSocket()?.emit('chat:read', { campId, channel: 'group' })
  }, [campId, serverMessages.length])
```

> `ChatMessage.status` is typed `MessageStatus | undefined` in `lib/chat.ts` — the `as typeof m` cast keeps the mapped object assignable. If `tsc` complains, type the array explicitly as `ChatMessage[]`.

- [ ] **Step 4: Mirror in `OrgChatScreen`**

In `frontend/src/components/organizer/chat/OrgChatScreen.tsx`, do the same for the organizers thread (`channel: 'organizers'`, `othersLastReadAt` from `orgData`) and, if the coordinator's group thread is shown, for `channel: 'group'` from `groupData`. Emit `chat:read` for whichever channel is currently visible.

- [ ] **Step 5: Verify + commit**

Run `cd frontend && npm run typecheck`. Expected: no errors. Two sessions: A sends while B has the chat **closed** → A's bubble shows `✓`. B opens the chat → A's bubble flips to blue `✓✓` live. Commit:

```bash
cd frontend
npx prettier --write --end-of-line auto src/api/services/chat.service.ts src/api/realtime/realtimeBridge.ts src/components/participant/chat/ChatScreen.tsx src/components/organizer/chat/OrgChatScreen.tsx
git add -A
git commit -m "feat(chat): double-tick read receipts (seen-by-anyone) + emit chat:read

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Workstream 3 — Live unread badge

### Task 7: Frontend — unread store + badge wiring

**Files:**
- Create: `frontend/src/store/useChatUnreadStore.ts`
- Modify: `frontend/src/api/realtime/realtimeBridge.ts` (seed from `chat:unread`, bump on `chat:message`)
- Modify: `frontend/src/components/participant/ParticipantDashboard.tsx` (badge from the store)
- Modify: `frontend/src/components/participant/chat/ChatScreen.tsx` + `frontend/src/components/organizer/chat/OrgChatScreen.tsx` (clear on open)

**Interfaces:**
- Produces: `useChatUnreadStore` — `{ counts: Record<string, number>, seed, bump, clear, total() }` keyed by `roomKey(channel, groupId)`.
- Produces: `roomKey(channel, groupId)` helper (exported from the store).

- [ ] **Step 1: Create the unread store**

`frontend/src/store/useChatUnreadStore.ts`:

```ts
import { create } from 'zustand'

/*
  CLIENT UI state: unread message counts per chat room. Seeded by the socket's
  chat:unread on connect, bumped when a chat:message arrives for a room the user
  isn't viewing, cleared when they open that thread (which also emits chat:read).
  NOT server data mirrored — it's a derived view counter the badge reads.
*/
export const roomKey = (channel: 'group' | 'organizers', groupId: string | null) =>
  channel === 'group' && groupId ? `group:${groupId}` : 'organizers'

type UnreadState = {
  counts: Record<string, number>
  seed: (rooms: { channel: 'group' | 'organizers'; groupId: string | null; count: number }[]) => void
  bump: (key: string) => void
  clear: (key: string) => void
  total: () => number
}

export const useChatUnreadStore = create<UnreadState>((set, get) => ({
  counts: {},
  seed: (rooms) =>
    set(() => ({
      counts: Object.fromEntries(rooms.map((r) => [roomKey(r.channel, r.groupId), r.count])),
    })),
  bump: (key) => set((s) => ({ counts: { ...s.counts, [key]: (s.counts[key] ?? 0) + 1 } })),
  clear: (key) => set((s) => ({ counts: { ...s.counts, [key]: 0 } })),
  total: () => Object.values(get().counts).reduce((a, b) => a + b, 0),
}))
```

- [ ] **Step 2: Seed + bump from the bridge**

In `frontend/src/api/realtime/realtimeBridge.ts`, import the store and a way to know the active room, then wire seed + bump. Add:

```ts
import { useChatUnreadStore, roomKey } from '@/store/useChatUnreadStore'

// The room the user is actively viewing (set by the chat screens); its messages
// don't count as unread. null = not on a chat screen.
let activeRoomKey: string | null = null
export function setActiveRoom(key: string | null) {
  activeRoomKey = key
}
```

Add the `chat:unread` handler and extend the existing `chat:message` handler to bump:

```ts
  socket.on('chat:unread', (evt: { rooms: { channel: 'group' | 'organizers'; groupId: string | null; count: number }[] }) => {
    useChatUnreadStore.getState().seed(evt.rooms)
  })
```

Inside the `chat:message` handler, after appending, bump unread when the message is for a room the user isn't currently viewing and isn't the author of:

```ts
  socket.on('chat:message', (evt: ChatMessageEvent) => {
    const key = keyFor(evt.channel, evt.groupId)
    if (key) appendMessage(key, evt.message)
    const rk = roomKey(evt.channel, evt.groupId)
    const myId = useAuthStore.getState().user?.id
    if (rk !== activeRoomKey && evt.message.authorId !== myId) {
      useChatUnreadStore.getState().bump(rk)
    }
  })
```

- [ ] **Step 3: Mark active room + clear on the chat screens**

In `frontend/src/components/participant/chat/ChatScreen.tsx`, mark the group room active while mounted and clear its count on open:

```tsx
import { setActiveRoom } from '@/api/realtime/realtimeBridge'
import { useChatUnreadStore, roomKey } from '@/store/useChatUnreadStore'
```

```tsx
  const clearUnread = useChatUnreadStore((s) => s.clear)
  useEffect(() => {
    if (!groupId) return
    const rk = roomKey('group', groupId)
    setActiveRoom(rk)
    clearUnread(rk)
    return () => setActiveRoom(null)
  }, [groupId, clearUnread])
```

Do the equivalent in `OrgChatScreen.tsx` for the visible channel (`roomKey('organizers', null)` or the coordinator group).

- [ ] **Step 4: Read the badge from the store**

In `frontend/src/components/participant/ParticipantDashboard.tsx`, replace the mock `home.unreadChat` with the live store total. Remove the `useCampHome` line if it was only for the badge (check — it may be reused; if so keep it and just switch the badge source):

```tsx
import { useChatUnreadStore } from '@/store/useChatUnreadStore'
```

```tsx
  const unreadTotal = useChatUnreadStore((s) => s.total())
  const onChat = location.pathname === '/camp/chat'
  const chatBadge = onChat ? undefined : unreadTotal || undefined
```

Wire the same badge into `frontend/src/components/organizer/OrganizerNav.tsx` for the org chat entry (read `useChatUnreadStore` total, hide when on the chat route).

- [ ] **Step 5: Verify + commit**

Run `cd frontend && npm run typecheck`. Expected: no errors. Two sessions: A on Home, B sends → A's Chat tab shows a `1` badge live; A opens Chat → badge clears; A returns to Home and B sends again → badge shows `1`. Commit:

```bash
cd frontend
npx prettier --write --end-of-line auto src/store/useChatUnreadStore.ts src/api/realtime/realtimeBridge.ts src/components/participant/ParticipantDashboard.tsx src/components/participant/chat/ChatScreen.tsx src/components/organizer/chat/OrgChatScreen.tsx src/components/organizer/OrganizerNav.tsx
git add -A
git commit -m "feat(chat): live unread badge driven by the socket

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Workstream 4 — Push notifications (heaviest; own phase)

### Task 8: Backend — VAPID env + `PushSubscription` model + generate keys

**Files:**
- Modify: `backend/src/config/env.ts`
- Create: `backend/src/models/pushSubscription.model.ts`
- Create: `backend/src/scripts/generateVapidKeys.ts`
- Modify: `backend/package.json` (add `web-push`)

- [ ] **Step 1: Add the `web-push` dependency**

```bash
cd backend
npm install web-push
npm install --save-dev @types/web-push
```

- [ ] **Step 2: Add optional VAPID env vars**

In `backend/src/config/env.ts`, add to `envSchema` (after the S3 block, before the closing `})`):

```ts
  // Web Push (VAPID). OPTIONAL so the app boots before keys are generated — the
  // sender no-ops with a warning when unset. Generate with `npm run vapid:gen`.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:ops@camply.dev'),
```

- [ ] **Step 3: Create the subscription model**

`backend/src/models/pushSubscription.model.ts`:

```ts
import { Schema, model, Types, type InferSchemaType } from 'mongoose'

/*
  A device's Web Push subscription. endpoint is the unique identity (a URL at the
  push service); POST /push/subscribe upserts on it so the SW's re-subscribe after
  pushsubscriptionchange never duplicates. Pruned on 410/404 at send time.
*/
const pushSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String },
  },
  { timestamps: true },
)

export type PushSubscription = InferSchemaType<typeof pushSubscriptionSchema> & {
  _id: Types.ObjectId
}
export const PushSubscriptionModel = model('PushSubscription', pushSubscriptionSchema)
```

- [ ] **Step 4: Create the key-generation script**

`backend/src/scripts/generateVapidKeys.ts`:

```ts
import webpush from 'web-push'

// One-time helper: prints a VAPID keypair to paste into env. The public key is
// ALSO the frontend's VITE_VAPID_PUBLIC_KEY (same value, exposed to the client).
const keys = webpush.generateVAPIDKeys()
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey)
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey)
console.log('\nFrontend .env → VITE_VAPID_PUBLIC_KEY=' + keys.publicKey)
```

Add a script to `backend/package.json` `"scripts"`: `"vapid:gen": "tsx src/scripts/generateVapidKeys.ts"`.

- [ ] **Step 5: Generate keys and set env**

```bash
cd backend
npm run vapid:gen
```

Paste `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` into `backend/.env`, and `VITE_VAPID_PUBLIC_KEY=<same public key>` into `frontend/.env`. (Keep `.env` untracked.)

- [ ] **Step 6: Verify + commit**

Run `cd backend && npm run typecheck`. Expected: no errors. Boot the server (`npm run dev`) — it must start cleanly (env vars optional). Commit (do **not** commit `.env`):

```bash
cd backend
npx prettier --write --end-of-line auto src/config/env.ts src/models/pushSubscription.model.ts src/scripts/generateVapidKeys.ts
git add src/config/env.ts src/models/pushSubscription.model.ts src/scripts/generateVapidKeys.ts package.json package-lock.json
git commit -m "feat(push): VAPID env + PushSubscription model + key-gen script

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 9: Backend — `/push/subscribe` endpoints + sender

**Files:**
- Create: `backend/src/validators/push.validators.ts`
- Create: `backend/src/services/push/sender.ts`
- Create: `backend/src/controllers/push.controllers.ts`
- Create: `backend/src/routes/push.routes.ts`
- Modify: `backend/src/routes/index.ts`
- Modify: `backend/src/docs/openapi.ts`

**Interfaces:**
- Produces: `pushSender.sendToUser(userId, payload: { title, body, url, tag? }) → Promise<void>` (prunes dead subs).
- Produces: `POST /api/push/subscribe`, `DELETE /api/push/subscribe`.

- [ ] **Step 1: Validators**

`backend/src/validators/push.validators.ts`:

```ts
import { z } from '../config/zod'

// The browser's PushSubscription.toJSON() shape. keys are always present for a
// real subscription; endpoint is the unique identity we upsert on.
export const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  }),
})

export const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
})

export type SubscribeInput = z.infer<typeof subscribeSchema>
export type UnsubscribeInput = z.infer<typeof unsubscribeSchema>
```

- [ ] **Step 2: Sender**

`backend/src/services/push/sender.ts`:

```ts
import webpush from 'web-push'
import { Types } from 'mongoose'
import { env } from '../../config/env'
import { PushSubscriptionModel } from '../../models/pushSubscription.model'

export type PushPayload = { title: string; body: string; url: string; tag?: string }

let configured = false
function ensureConfigured(): boolean {
  if (configured) return true
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.warn('⚠️  Web Push disabled: VAPID keys unset (run `npm run vapid:gen`).')
    return false
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
  configured = true
  return true
}

export const pushSender = {
  // Send to every device the user has. Dead endpoints (410/404) self-prune.
  sendToUser: async (userId: Types.ObjectId, payload: PushPayload): Promise<void> => {
    if (!ensureConfigured()) return
    const subs = await PushSubscriptionModel.find({ userId })
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
            JSON.stringify(payload),
          )
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          if (status === 410 || status === 404) {
            await PushSubscriptionModel.deleteOne({ _id: sub._id })
          } else {
            console.error('push send failed', status, sub.endpoint)
          }
        }
      }),
    )
  },
}
```

- [ ] **Step 3: Controller (thin, no try/catch)**

`backend/src/controllers/push.controllers.ts`:

```ts
import type { RequestHandler } from 'express'
import { Types } from 'mongoose'
import { PushSubscriptionModel } from '../models/pushSubscription.model'

// Upsert on endpoint — the SW re-posts after pushsubscriptionchange, so a duplicate
// must be idempotent, not a 409.
export const subscribe: RequestHandler = async (req, res) => {
  const { subscription } = req.body as {
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
  }
  await PushSubscriptionModel.updateOne(
    { endpoint: subscription.endpoint },
    {
      $set: {
        userId: new Types.ObjectId(String(req.auth!.user._id)),
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        userAgent: req.get('user-agent') ?? undefined,
      },
    },
    { upsert: true },
  )
  res.status(201).json({ ok: true })
}

export const unsubscribe: RequestHandler = async (req, res) => {
  const { endpoint } = req.body as { endpoint: string }
  await PushSubscriptionModel.deleteOne({ endpoint })
  res.status(204).end()
}
```

> Match `req.auth!.user._id` to the actual augmented shape in `backend/src/types/express.d.ts` (use `.id` if that's what it exposes), same as Task 1 Step 4.

- [ ] **Step 4: Routes + mount**

`backend/src/routes/push.routes.ts`:

```ts
import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware'
import { validate } from '../middlewares/validate.middleware'
import { subscribeSchema, unsubscribeSchema } from '../validators/push.validators'
import { subscribe, unsubscribe } from '../controllers/push.controllers'

const router = Router()

router.post('/subscribe', requireAuth, validate({ body: subscribeSchema }), subscribe)
router.delete('/subscribe', requireAuth, validate({ body: unsubscribeSchema }), unsubscribe)

export default router
```

> Confirm the exact import paths/names for `requireAuth` and `validate` against an existing route file (e.g. `backend/src/routes/me.routes.ts`) and match them.

In `backend/src/routes/index.ts`, add the import and mount:

```ts
import pushRoutes from './push.routes'
```
```ts
router.use('/push', pushRoutes)
```

- [ ] **Step 5: OpenAPI registration**

In `backend/src/docs/openapi.ts`, register both endpoints reusing the validator schemas (follow the existing `registry.registerPath` pattern in that file — match its exact call shape). Register `POST /push/subscribe` (body `subscribeSchema`, 201) and `DELETE /push/subscribe` (body `unsubscribeSchema`, 204).

- [ ] **Step 6: Verify + commit**

Run `cd backend && npm run typecheck`. Expected: no errors. Boot the server and open `/api/docs` — the two push endpoints appear. `curl -X POST localhost:4000/api/push/subscribe` without auth → 401. Commit:

```bash
cd backend
npx prettier --write --end-of-line auto src/validators/push.validators.ts src/services/push/sender.ts src/controllers/push.controllers.ts src/routes/push.routes.ts src/routes/index.ts src/docs/openapi.ts
git add -A
git commit -m "feat(push): /push/subscribe endpoints + web-push sender with self-pruning

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 10: Backend — `User.language`, `notify.service`, i18n map, hook into chat send

**Files:**
- Modify: `backend/src/models/user.model.ts`
- Modify: `backend/src/validators/auth.validators.ts`
- Create: `backend/src/routes/auth.routes.ts` route + controller for language (or extend `me.routes`)
- Create: `backend/src/i18n/notifications.ts`
- Create: `backend/src/services/notify.service.ts`
- Modify: `backend/src/sockets/chat.handlers.ts` (call notify after `chat:send`)
- Modify: `backend/src/services/auth.services.ts` + `backend/src/controllers/auth.controllers.ts` (setLanguage)

**Interfaces:**
- Consumes: `pushSender.sendToUser` (Task 9).
- Produces: `notify.chatMessage({ campId, channel, groupId, authorId, authorName, text, roomMemberIds, connectedUserIds })`.
- Produces: `PATCH /api/auth/me/language { language }`.

- [ ] **Step 1: Add `language` to the User model**

In `backend/src/models/user.model.ts`, add after `subRole` (before `passwordHash`):

```ts
    // UI language, synced from the client so the server can localize push copy.
    // Defaults to 'uz'; the client PATCHes it on change.
    language: { type: String, enum: ['uz', 'ru', 'en'], default: 'uz' },
```

- [ ] **Step 2: Add the language validator + endpoint**

In `backend/src/validators/auth.validators.ts`:

```ts
export const setLanguageSchema = z.object({
  language: z.enum(['uz', 'ru', 'en']),
})
export type SetLanguageInput = z.infer<typeof setLanguageSchema>
```

In `backend/src/controllers/auth.controllers.ts`, add:

```ts
export const setLanguage: RequestHandler = async (req, res) => {
  const user = await authService.setLanguage(req.auth!.user, req.body)
  res.json(user)
}
```

In `backend/src/services/auth.services.ts`, add to `authService` (mirror `completeProfile`'s save + `toPublicUser`):

```ts
  setLanguage: async (
    user: HydratedDocument<User>,
    input: { language: 'uz' | 'ru' | 'en' },
  ): Promise<PublicUser> => {
    user.language = input.language
    await user.save()
    return toPublicUser(user)
  },
```

In `backend/src/routes/auth.routes.ts`, add the import + route:

```ts
import { loginSchema, completeProfileSchema, setLanguageSchema } from '../validators/auth.validators'
import { login, me, logout, logoutAll, completeProfile, setLanguage } from '../controllers/auth.controllers'
```
```ts
router.patch('/me/language', requireAuth, validate({ body: setLanguageSchema }), setLanguage)
```

> If `PublicUser` should now expose `language`, add it in `toPublicUser` — check that projection and include `language: user.language ?? 'uz'` so the client can read the current value.

- [ ] **Step 3: Server-side notification copy**

`backend/src/i18n/notifications.ts`:

```ts
type Lang = 'uz' | 'ru' | 'en'

// The SMALL server-side copy map — only strings the server sends as push. UI copy
// stays in the frontend. interpolate {sender}/{group} per language grammar.
const NEW_MESSAGE: Record<Lang, { groupTitle: string; orgTitle: string; body: string }> = {
  uz: { groupTitle: 'Yangi xabar', orgTitle: 'Tashkilotchilar chati', body: '{sender}: {text}' },
  ru: { groupTitle: 'Новое сообщение', orgTitle: 'Чат организаторов', body: '{sender}: {text}' },
  en: { groupTitle: 'New message', orgTitle: 'Organizers chat', body: '{sender}: {text}' },
}

export function newMessagePush(
  lang: Lang,
  channel: 'group' | 'organizers',
  sender: string,
  text: string,
): { title: string; body: string } {
  const c = NEW_MESSAGE[lang] ?? NEW_MESSAGE.uz
  const snippet = text.length > 80 ? text.slice(0, 79) + '…' : text
  return {
    title: channel === 'organizers' ? c.orgTitle : c.groupTitle,
    body: c.body.replace('{sender}', sender).replace('{text}', snippet),
  }
}
```

- [ ] **Step 4: The notify dispatcher**

`backend/src/services/notify.service.ts`:

```ts
import { Types } from 'mongoose'
import { UserModel } from '../models/user.model'
import { pushSender } from './push/sender'
import { newMessagePush } from '../i18n/notifications'

type Lang = 'uz' | 'ru' | 'en'

export const notify = {
  // Push a new chat message to room members who are NOT currently connected to the
  // room (and never the author). Copy is rendered in each recipient's language.
  chatMessage: async (input: {
    campId: string
    channel: 'group' | 'organizers'
    groupId: string | null
    authorId: string
    authorName: string
    text: string
    roomMemberIds: string[]
    connectedUserIds: string[]
  }): Promise<void> => {
    const connected = new Set([...input.connectedUserIds, input.authorId])
    const recipients = input.roomMemberIds.filter((id) => !connected.has(id))
    if (recipients.length === 0) return

    const url = input.channel === 'organizers' ? '/org/chat' : '/camp/chat'
    const users = await UserModel.find({ _id: { $in: recipients.map((r) => new Types.ObjectId(r)) } })
    await Promise.all(
      users.map((u) => {
        const lang = ((u.language as Lang) ?? 'uz') as Lang
        const { title, body } = newMessagePush(lang, input.channel, input.authorName, input.text)
        return pushSender.sendToUser(u._id, { title, body, url, tag: `chat:${input.campId}:${input.channel}` })
      }),
    )
  },
}
```

> Confirm the org chat deep-link route (`/org/chat`) against `frontend/src/App.tsx`; use the actual organizer chat path.

- [ ] **Step 5: Call notify after `chat:send`**

In `backend/src/sockets/chat.handlers.ts`, import notify and the member projections, then after each successful broadcast in `chat:send`, resolve the room's members + connected ids and dispatch. Add import:

```ts
import { notify } from '../services/notify.service'
```

For the **organizers** branch, after `io.to(orgRoom(campId)).emit('chat:message', …)`:

```ts
      const members = await chatService.organizerMembers(new Types.ObjectId(campId))
      const connected = await onlineUserIds(io, orgRoom(campId))
      const author = members.find((m) => m.id === user.id)
      await notify.chatMessage({
        campId,
        channel: 'organizers',
        groupId: null,
        authorId: user.id,
        authorName: author?.name || 'Camply',
        text,
        roomMemberIds: members.map((m) => m.id),
        connectedUserIds: connected,
      })
```

For the **group** branch, after `io.to(groupRoom(campId, groupId)).emit('chat:message', …)`:

```ts
    const members = await chatService.groupMembers(new Types.ObjectId(campId), new Types.ObjectId(groupId))
    const connected = await onlineUserIds(io, groupRoom(campId, groupId))
    const author = members.find((m) => m.id === user.id)
    await notify.chatMessage({
      campId,
      channel: 'group',
      groupId,
      authorId: user.id,
      authorName: author?.name || 'Camply',
      text,
      roomMemberIds: members.map((m) => m.id),
      connectedUserIds: connected,
    })
```

- [ ] **Step 6: Verify + commit**

Run `cd backend && npm run typecheck`. Expected: no errors. Manual: `PATCH /api/auth/me/language {"language":"ru"}` (authed) → 200 with the updated user. Full push verification lands in Task 11 (needs the client subscribed). Commit:

```bash
cd backend
npx prettier --write --end-of-line auto src/models/user.model.ts src/validators/auth.validators.ts src/controllers/auth.controllers.ts src/services/auth.services.ts src/routes/auth.routes.ts src/i18n/notifications.ts src/services/notify.service.ts src/sockets/chat.handlers.ts
git add -A
git commit -m "feat(push): User.language + notify.service + i18n copy + chat-send dispatch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 11: Frontend — activate push + language sync

**Files:**
- Modify: `frontend/src/api/services/push.service.ts` (uncomment the real calls)
- Create: `frontend/src/hooks/useLanguageSync.ts`
- Modify: the authed shells to mount `useLanguageSync()` (`ParticipantDashboard.tsx`, `OrganizerShell.tsx`, `AdminShell.tsx`)

**Interfaces:**
- Consumes: `PATCH /api/auth/me/language` (Task 10).
- Consumes: `POST/DELETE /api/push/subscribe` (Task 9).

- [ ] **Step 1: Activate the push service calls**

Replace `frontend/src/api/services/push.service.ts` bodies with the real calls:

```ts
import { axiosInstance } from '../axiosInstance'

export type RegisterSubscriptionRequest = { subscription: PushSubscriptionJSON }
export type UnregisterSubscriptionRequest = { endpoint: string }

export const pushService = {
  registerSubscription: async (subscription: PushSubscriptionJSON): Promise<void> => {
    await axiosInstance.post('/push/subscribe', { subscription })
  },
  unregisterSubscription: async (endpoint: string): Promise<void> => {
    await axiosInstance.delete('/push/subscribe', { data: { endpoint } })
  },
}
```

- [ ] **Step 2: Language-sync hook**

`frontend/src/hooks/useLanguageSync.ts`:

```ts
import { useEffect, useRef } from 'react'
import { useLanguageStore } from '@/i18n/useLanguageStore'
import { useAuthStore } from '@/store/useAuthStore'
import { axiosInstance } from '@/api/axiosInstance'

/*
  Pushes the client's chosen UI language to the server (PATCH /auth/me/language) so
  push notifications can be rendered in it. Fires when authenticated and the choice
  changes. Fire-and-forget — a failed sync just means push falls back to 'uz'.
*/
export function useLanguageSync() {
  const lang = useLanguageStore((s) => s.selectedLang)
  const userId = useAuthStore((s) => s.user?.id)
  const lastSynced = useRef<string | null>(null)

  useEffect(() => {
    if (!userId || !lang) return
    if (lastSynced.current === lang) return
    lastSynced.current = lang
    void axiosInstance.patch('/auth/me/language', { language: lang })
  }, [userId, lang])
}
```

- [ ] **Step 3: Mount the hook in the authed shells**

Call `useLanguageSync()` once inside each authed shell component body: `frontend/src/components/participant/ParticipantDashboard.tsx`, `frontend/src/components/organizer/OrganizerShell.tsx`, `frontend/src/components/organization/AdminShell.tsx`. Add `import { useLanguageSync } from '@/hooks/useLanguageSync'` and call it near the top of each component.

- [ ] **Step 4: Verify end-to-end + commit**

Run `cd frontend && npm run typecheck`. Expected: no errors. Full push test (needs VAPID env from Task 8 set on both sides, and HTTPS or `localhost`):
1. In session B, enable notifications via the Profile toggle (subscribes → `POST /push/subscribe`; confirm a row in the `pushsubscriptions` collection).
2. **Close** B's tab (or background it). From A, send a message.
3. B receives an OS notification; tapping it opens `/camp/chat`.
4. With B's tab **open and on the chat**, A sends again → B gets the socket update and **no** push.
5. Set B's language to Russian → the next push copy is Russian.
6. Revoke B's subscription (DevTools → Application → Service Workers → Push, or unsubscribe) → the next send logs a 410 and the row is pruned.

```bash
cd frontend
npx prettier --write --end-of-line auto src/api/services/push.service.ts src/hooks/useLanguageSync.ts src/components/participant/ParticipantDashboard.tsx src/components/organizer/OrganizerShell.tsx src/components/organization/AdminShell.tsx
git add -A
git commit -m "feat(push): activate subscribe calls + sync UI language to the server

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Docs update (do last, in the same effort)

- [ ] Update `backend/CLAUDE.md` "Realtime chat" section: reactions now persist on `Message`; new `ChatRead` model + `chatRead.services`; `chat:react`/`chat:read`/`chat:unread` socket events; new `/push/subscribe` domain + `notify.service` + `PushSubscription` + `User.language` + `src/i18n/notifications.ts`; note VAPID env vars and the stale-index gotcha if any old index lingers.
- [ ] Update `frontend/CLAUDE.md`: `realtimeBridge` now handles `chat:reaction`/`chat:read`/`chat:unread`; new `useChatUnreadStore`; reactions/receipts are server truth; push is live (`push.service` activated, `useLanguageSync`).
- [ ] Commit both CLAUDE.md updates in their repos.

## Self-Review (completed during authoring)

- **Spec coverage:** delivery fix → Task 0; reactions → Tasks 1–3; receipts → Tasks 4–6; unread → Task 7; push (VAPID/model/routes/sender/notify/language/i18n/FE) → Tasks 8–11. All spec sections mapped.
- **Type consistency:** `toChatMessage(doc, viewerId?)`, `toggleReaction`, `MessageReaction { emoji, count, mine }`, `roomKey(channel, groupId)`, `notify.chatMessage(...)`, `pushSender.sendToUser(...)`, `othersLastReadAt: string | null`, SW payload `{ title, body, url, tag? }` — used consistently across tasks.
- **Known adaptation:** no TDD test cycles (project forbids a test runner); verification is `typecheck`/`validate` + the named manual runtime check per task.
- **Watch-outs flagged inline:** the exact `req.auth` id accessor (`._id` vs `.id`), the org chat deep-link route, and the `requireAuth`/`validate` import paths must be matched against existing files during execution — each is noted at its task.
