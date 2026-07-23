# Chat Reply (reply-to-a-specific-message) — Design

**Date:** 2026-07-23
**Status:** Approved
**Surfaces:** participant chat (`/camp/chat`), organizer/manager chat (`/org/chat`)

## Problem

The chat's reply UI is already fully built and wired — `MessageBubble` renders a
`ReplyQuote`, the tap-to-open action bar has a **Reply** button, both `ChatScreen`
and `OrgChatScreen` hold `replyingTo` state and feed the `Composer` a quote
preview, and `t.chat.reply` ships in EN/UZ/RU. But **the reply target is dropped
at send time** and **the backend has no concept of a reply** — so replying does
nothing beyond a transient composer chrome that vanishes on send.

This design connects the existing UI to real, persisted, broadcast reply data,
and makes the quote **tappable to jump to the original message**.

## Approach

**Denormalized snapshot, resolved server-side.** The frozen frontend contract
(`lib/chat.ts`) already declares the shape and intent:

```ts
replyTo?: { authorName: string; text: string } // "denormalized so it survives even if the original is later deleted"
```

We honor that — a reply carries a **snapshot** of the quoted message, not a live
reference — with two refinements:

1. **The client emits only `replyToId`** (the original message's id). The server
   looks up that message **scoped to the same room** (campId + channel + groupId),
   resolves the _real_ author name, snapshots a truncated copy of its text, and
   persists + echoes the `replyTo`.

   Why server-resolved rather than client-supplied: the frontend's `authorNameOf`
   returns the **localized "You"/"Siz"/"Вы"** for your own messages — persisting
   that would show "You" to everyone. A client-supplied snapshot is also
   spoofable. Server resolution gives a **viewer-neutral, un-spoofable,
   deletion-proof** quote for free. The composer's live preview stays local (it
   still shows "You" while you type — only the sender sees it; that's correct).

2. **The snapshot stores the source `messageId`**, so the quote is **tappable**:
   tapping it scrolls to and briefly highlights the original message. If the
   original has scrolled out of the loaded 50-message window, the tap is a no-op
   (acceptable — no fetch-older here).

A bad/foreign `replyToId` (e.g. original deleted concurrently, or a client
pointing outside its room) **degrades gracefully** to a normal, unquoted message
rather than erroring.

## Data model

`Message.replyTo` — an optional embedded subdoc (`_id: false`, `default: null`):

```ts
replyTo: {
  messageId: ObjectId (ref Message, required),
  authorName: String (required),   // real sender name, viewer-neutral
  text: String (required),         // truncated snapshot, ≤ 120 chars + '…'
}
```

Denormalized on purpose: no populate, survives deletion of the original.

## Wire contract

`chat:send` payload gains one optional field:

```ts
{ campId, channel, text, replyToId?: string /* 24-hex ObjectId */ }
```

`groupId` remains server-derived (unchanged). The `chat:message` echo already
carries the whole `ChatMessage`, so `replyTo` rides along to every client with no
new event — both live sends and history load render replies identically.

Frontend `ChatMessage.replyTo` widens to include the id:

```ts
replyTo?: { messageId: string; authorName: string; text: string }
```

## Flow

1. User taps a bubble → **Reply** → `replyingTo` set → `Composer` shows the quote.
2. User sends → `handleSendText` passes `replyingTo.id` → store emits
   `chat:send { ..., replyToId }`.
3. Server (`postMessage`) resolves the room-scoped snapshot, persists the message
   with `replyTo`, broadcasts `chat:message`.
4. Every client appends the echoed message (existing realtimeBridge path); the
   bubble renders `ReplyQuote`.
5. Tapping a `ReplyQuote` → `jumpTo(replyTo.messageId)` → smooth-scroll + ~1.6s
   highlight ring on the target bubble (no-op if off-window).

## Out of scope (YAGNI)

- Fetch-older-to-reveal when the original is off-window — quote tap simply no-ops.
- Replying to image/file/system messages — chat is text-only server-side today;
  the snippet helper already handles those shapes client-side for when it isn't.
- A REST send endpoint — chat send is socket-only; no OpenAPI change.
