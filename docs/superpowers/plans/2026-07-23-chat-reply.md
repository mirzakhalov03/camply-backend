# Chat Reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the already-built chat reply UI actually persist, broadcast, and
render replies, with a tappable quote that jumps to the original message.

**Architecture:** Client emits `replyToId`; the server resolves a room-scoped,
viewer-neutral, denormalized snapshot (`{ messageId, authorName, text }`),
persists it on the message, and echoes it via the existing `chat:message` event.
The quote is a button that scrolls to + highlights the original.

**Tech Stack:** Backend — Express 5, Mongoose 9, Zod 4, Socket.IO, TS (CommonJS,
strict). Frontend — React 19, Vite, Tailwind v4, Zustand, socket.io-client.

## Global Constraints

- **No tests** — both CLAUDE.md files forbid a test runner. Verify with
  `npm run typecheck` (backend + frontend) / `npm run validate`, plus manual
  runtime checks. Never add a test file.
- **Zod:** import `z` from `../config/zod`, never `'zod'`.
- **Prettier:** no semicolons, single quotes, width 100. Format only touched
  files: `npx prettier --write --end-of-line auto <files>`.
- **`import type`** for type-only imports (verbatimModuleSyntax).
- **Two separate repos.** Backend `/Users/mn.afridi/Desktop/Camply/backend`,
  frontend `/Users/mn.afridi/Desktop/Camply/frontend`. Commit each independently.
- **Server derives `groupId`.** The client never names a room; `replyToId` is the
  only new client-supplied field and is room-scoped-validated server-side.
- **Graceful degrade:** an unresolvable `replyToId` yields a normal message, never
  an error.

---

### Task 1: Backend — persist & broadcast `replyTo`

**Files:**

- Modify: `backend/src/models/message.model.ts`
- Modify: `backend/src/validators/chat.validators.ts`
- Modify: `backend/src/services/chat.services.ts`
- Modify: `backend/src/sockets/chat.handlers.ts`

**Interfaces:**

- Produces: `ChatMessage.replyTo?: { messageId: string; authorName: string; text: string }`
  on the wire (via `chat:message` and history). `chat:send` accepts optional
  `replyToId: string` (24-hex).

- [ ] **Step 1: Add the `replyTo` subdoc to the Message schema**

In `message.model.ts`, inside the `messageSchema` fields (after `reactions`):

```ts
    // Optional denormalized snapshot of the message this one replies to. Stored
    // (not populated) so the quote survives deletion of the original. Built
    // server-side from a client-sent replyToId — see chat.services.postMessage.
    replyTo: {
      type: new Schema(
        {
          messageId: { type: Schema.Types.ObjectId, ref: 'Message', required: true },
          authorName: { type: String, required: true },
          text: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
```

- [ ] **Step 2: Accept `replyToId` on the send payload**

In `chat.validators.ts`, add to `sendMessageSchema` (after `text`):

```ts
  // Optional — the message this one replies to. Room-scoped + resolved to a
  // snapshot server-side; a bad id degrades to a normal message.
  replyToId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid replyToId')
    .optional(),
```

- [ ] **Step 3: Add the reply type + projection + resolution in the service**

In `chat.services.ts`:

Add the type next to `MessageReaction`:

```ts
export type ReplySnapshot = { messageId: string; authorName: string; text: string }
```

Add `replyTo` to the `ChatMessage` type (after `reactions`):

```ts
  replyTo?: ReplySnapshot
```

Project it in `toChatMessage` — inside the returned object, after `reactions`:

```ts
    replyTo: doc.replyTo
      ? {
          messageId: String(doc.replyTo.messageId),
          authorName: doc.replyTo.authorName,
          text: doc.replyTo.text,
        }
      : undefined,
```

Add a truncation helper near `hhmm`:

```ts
const REPLY_SNIPPET_MAX = 120
const snippet = (s: string) =>
  s.length > REPLY_SNIPPET_MAX ? `${s.slice(0, REPLY_SNIPPET_MAX)}…` : s
```

Extend `postMessage`'s input with `replyToId?: Types.ObjectId` and resolve the
snapshot before the create. Replace the whole `postMessage` with:

```ts
  // Persist + project. The one write path both REST (none today) and the socket
  // use. Resolves an optional reply target to a room-scoped snapshot; a target
  // outside this room (or missing) is dropped, degrading to a normal message.
  postMessage: async (input: {
    campId: Types.ObjectId
    channel: MessageChannel
    groupId: Types.ObjectId | null
    authorId: Types.ObjectId
    text: string
    replyToId?: Types.ObjectId
  }): Promise<ChatMessage> => {
    const groupId = input.channel === 'group' ? input.groupId : null

    let replyTo: { messageId: Types.ObjectId; authorName: string; text: string } | null = null
    if (input.replyToId) {
      const orig = await MessageModel.findOne({
        _id: input.replyToId,
        campId: input.campId,
        channel: input.channel,
        groupId,
      })
      if (orig) {
        const author = await UserModel.findById(orig.authorId)
        const authorName = author ? `${author.name ?? ''} ${author.surname ?? ''}`.trim() : ''
        replyTo = { messageId: orig._id, authorName, text: snippet(orig.text) }
      }
    }

    const doc = await MessageModel.create({
      campId: input.campId,
      channel: input.channel,
      groupId,
      authorId: input.authorId,
      text: input.text,
      replyTo,
    })
    return toChatMessage(doc)
  },
```

- [ ] **Step 4: Pass `replyToId` through both send branches**

In `chat.handlers.ts` `chat:send`, destructure it and forward it in both
`postMessage` calls. Change the destructure:

```ts
const { campId, channel, text, replyToId } = parsed.data
```

In the `organizers` branch `postMessage({ ... })` add:

```ts
        replyToId: replyToId ? new Types.ObjectId(replyToId) : undefined,
```

In the `group` branch `postMessage({ ... })` add the same line.

- [ ] **Step 5: Typecheck the backend**

Run: `cd /Users/mn.afridi/Desktop/Camply/backend && npm run typecheck`
Expected: PASS (0 errors). If `doc.replyTo` types as possibly-undefined that's
handled by the `? :` guard in `toChatMessage`.

- [ ] **Step 6: Format + commit**

```bash
cd /Users/mn.afridi/Desktop/Camply/backend
npx prettier --write --end-of-line auto \
  src/models/message.model.ts src/validators/chat.validators.ts \
  src/services/chat.services.ts src/sockets/chat.handlers.ts \
  docs/superpowers/specs/2026-07-23-chat-reply-design.md docs/superpowers/plans/2026-07-23-chat-reply.md
git add -A
git commit -m "feat(chat): persist & broadcast message replies (server-resolved snapshot)"
```

---

### Task 2: Frontend — send the reply target

**Files:**

- Modify: `frontend/src/lib/chat.ts`
- Modify: `frontend/src/store/useChatStore.ts`
- Modify: `frontend/src/store/useOrgChatStore.ts`
- Modify: `frontend/src/components/participant/chat/ChatScreen.tsx`
- Modify: `frontend/src/components/organizer/chat/OrgChatScreen.tsx`

**Interfaces:**

- Consumes: server `replyTo` from Task 1.
- Produces: `sendText(..., replyToId?: string)` on both stores; `ChatMessage.replyTo`
  gains `messageId` (consumed by Task 3).

- [ ] **Step 1: Widen the `replyTo` contract with `messageId`**

In `lib/chat.ts`, change the `replyTo` field on `ChatMessage`:

```ts
  /** Snapshot of the message this one replies to (denormalized so it survives
      even if the original is later deleted). `messageId` targets the original
      for tap-to-jump. */
  replyTo?: { messageId: string; authorName: string; text: string }
```

- [ ] **Step 2: Add `replyToId` to the participant store's `sendText`**

In `useChatStore.ts`, update the type in `ChatState`:

```ts
  sendText: (campId: string, groupId: string, text: string, replyToId?: string) => void
```

And the implementation:

```ts
  sendText: (campId, _groupId, text, replyToId) => {
    const clean = text.trim()
    if (!clean) return
    // The server re-derives groupId from membership; channel is enough on the wire.
    getSocket()?.emit('chat:send', { campId, channel: 'group', text: clean, replyToId })
  },
```

- [ ] **Step 3: Add `replyToId` to the org store's `sendText`**

In `useOrgChatStore.ts`, update the type:

```ts
  sendText: (campId: string, channel: OrgChatChannelId, text: string, replyToId?: string) => void
```

And the implementation:

```ts
  sendText: (campId, channel, text, replyToId) => {
    const clean = text.trim()
    if (!clean) return
    getSocket()?.emit('chat:send', { campId, channel, text: clean, replyToId })
  },
```

- [ ] **Step 4: Pass the reply target from both send handlers**

In `ChatScreen.tsx`, change `handleSendText`:

```ts
const handleSendText = (text: string) => {
  sendText(campId, groupId, text, replyingTo?.id)
  setReplyingTo(null)
}
```

In `OrgChatScreen.tsx`, change `handleSendText`:

```ts
const handleSendText = (text: string) => {
  sendText(campId, channel, text, replyingTo?.id)
  setReplyingTo(null)
}
```

- [ ] **Step 5: Typecheck the frontend**

Run: `cd /Users/mn.afridi/Desktop/Camply/frontend && npm run typecheck`
Expected: PASS (0 errors).

- [ ] **Step 6: Format + commit**

```bash
cd /Users/mn.afridi/Desktop/Camply/frontend
npx prettier --write --end-of-line auto \
  src/lib/chat.ts src/store/useChatStore.ts src/store/useOrgChatStore.ts \
  src/components/participant/chat/ChatScreen.tsx \
  src/components/organizer/chat/OrgChatScreen.tsx \
  docs/superpowers/specs/2026-07-23-chat-reply-design.md docs/superpowers/plans/2026-07-23-chat-reply.md
git add -A
git commit -m "feat(chat): send reply target (replyToId) from both chat surfaces"
```

---

### Task 3: Frontend — tappable quote jumps to the original

**Files:**

- Modify: `frontend/src/components/participant/chat/MessageBubble.tsx`
- Modify: `frontend/src/components/participant/chat/MessageList.tsx`
- Modify: `frontend/src/components/organizer/chat/OrgChatScreen.tsx` (the inline
  `MessageThread`)

**Interfaces:**

- Consumes: `ChatMessage.replyTo.messageId` (Task 2). `MessageBubble` gains
  `registerNode`, `highlighted`, `onJumpToReply` props; both list renderers own a
  node-ref map + highlight state.

- [ ] **Step 1: Make `ReplyQuote` a button and add jump/highlight props to `MessageBubble`**

In `MessageBubble.tsx`, add three props to `Props`:

```ts
  /** Attach the row's DOM node so the list can scroll to it (jump-to-reply target). */
  registerNode?: (el: HTMLDivElement | null) => void
  /** Briefly highlighted because another reply jumped here. */
  highlighted?: boolean
  /** Tap the reply quote to jump to the original (undefined when there's no reply). */
  onJumpToReply?: () => void
```

Change `ReplyQuote` to a button that fires `onJump`:

```ts
// Quoted preview of the message being replied to. Tapping it jumps to the original.
function ReplyQuote({
  replyTo,
  onJump,
}: {
  replyTo: NonNullable<ChatMessage['replyTo']>
  onJump?: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onJump?.()
      }}
      className="mb-1.5 block w-full rounded-md border-l-2 border-black/25 bg-black/5 py-1 pl-2 pr-2 text-left"
    >
      <div className="text-[10px] font-bold opacity-90">{replyTo.authorName}</div>
      <div className="line-clamp-1 text-[11px] opacity-75">{replyTo.text}</div>
    </button>
  )
}
```

Destructure the new props in `MessageBubble({ ... })`:

```ts
export function MessageBubble({
  message,
  author,
  onAuthorTap,
  reactions,
  onToggleReaction,
  onReply,
  registerNode,
  highlighted,
  onJumpToReply,
}: Props) {
```

Attach `ref={registerNode}` and a highlight ring to the outer div of each of the
three returns, and pass `onJump` into both `ReplyQuote` usages.

System branch outer div:

```tsx
    <div ref={registerNode} className="flex justify-center">
```

`sentByMe` branch outer div:

```tsx
      <div
        ref={registerNode}
        className={`flex flex-col items-end rounded-2xl transition ${
          highlighted ? 'ring-2 ring-pine/60' : ''
        }`}
      >
```

…and its quote: `{message.replyTo && <ReplyQuote replyTo={message.replyTo} onJump={onJumpToReply} />}`

`other` branch outer div:

```tsx
    <div
      ref={registerNode}
      className={`flex items-end gap-2 rounded-2xl transition ${
        highlighted ? 'ring-2 ring-pine/60' : ''
      }`}
    >
```

…and its quote (inside the bubble button): `{message.replyTo && <ReplyQuote replyTo={message.replyTo} onJump={onJumpToReply} />}`

- [ ] **Step 2: Wire the node map + jump in the participant `MessageList`**

In `MessageList.tsx`, add `useState` to the imports:

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
```

Inside the component, after `bottomRef`:

```ts
// DOM nodes by message id, so a reply quote can scroll to its original.
const nodeRefs = useRef(new Map<string, HTMLDivElement>())
const [highlightId, setHighlightId] = useState<string | null>(null)

const jumpTo = (id: string) => {
  const el = nodeRefs.current.get(id)
  if (!el) return // original scrolled out of the loaded window — no-op
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  setHighlightId(id)
  window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1600)
}
```

Pass the new props to `<MessageBubble>`:

```tsx
            registerNode={(el) => {
              if (el) nodeRefs.current.set(m.id, el)
              else nodeRefs.current.delete(m.id)
            }}
            highlighted={highlightId === m.id}
            onJumpToReply={m.replyTo ? () => jumpTo(m.replyTo!.messageId) : undefined}
```

- [ ] **Step 3: Wire the same into the org `MessageThread`**

In `OrgChatScreen.tsx`, ensure `useState` is imported (it already is — it's used
for `replyingTo`). Inside `MessageThread`, after `bottomRef`:

```ts
const nodeRefs = useRef(new Map<string, HTMLDivElement>())
const [highlightId, setHighlightId] = useState<string | null>(null)

const jumpTo = (id: string) => {
  const el = nodeRefs.current.get(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  setHighlightId(id)
  window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1600)
}
```

Pass to its `<MessageBubble>`:

```tsx
            registerNode={(el) => {
              if (el) nodeRefs.current.set(m.id, el)
              else nodeRefs.current.delete(m.id)
            }}
            highlighted={highlightId === m.id}
            onJumpToReply={m.replyTo ? () => jumpTo(m.replyTo!.messageId) : undefined}
```

Confirm `useState` is in the `OrgChatScreen.tsx` React import; if not, add it.

- [ ] **Step 4: Typecheck the frontend**

Run: `cd /Users/mn.afridi/Desktop/Camply/frontend && npm run typecheck`
Expected: PASS (0 errors).

- [ ] **Step 5: Format + commit**

```bash
cd /Users/mn.afridi/Desktop/Camply/frontend
npx prettier --write --end-of-line auto \
  src/components/participant/chat/MessageBubble.tsx \
  src/components/participant/chat/MessageList.tsx \
  src/components/organizer/chat/OrgChatScreen.tsx
git add -A
git commit -m "feat(chat): tappable reply quote jumps to and highlights the original"
```

---

## Manual verification (after all tasks)

1. Two browsers, same group. A replies to one of B's messages → B sees the message
   with a quote showing **A's real name** (not "You") + the snippet.
2. Reply to your own message → the quote shows **your real name**, not "You".
3. Tap a reply quote → smooth-scrolls to the original + ~1.6s highlight ring.
4. Reply to a very old message, then scroll to the newest → tapping its quote
   no-ops if the original is off-window (no crash).
5. Organizers channel + a group channel both behave identically.

## Self-Review Notes

- **Spec coverage:** snapshot storage (T1), server resolution + graceful degrade
  (T1), send wiring both surfaces (T2), tappable jump + highlight + off-window
  no-op (T3). All covered.
- **Type consistency:** `replyToId` (client→server, string/ObjectId), `replyTo`
  `{ messageId, authorName, text }` consistent across model, service type,
  `lib/chat.ts`, and the `jumpTo(m.replyTo.messageId)` consumer.
- **No placeholders:** every step carries real code.
