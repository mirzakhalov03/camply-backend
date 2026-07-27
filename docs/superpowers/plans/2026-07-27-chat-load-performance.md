# Chat Load Performance — Waterfall, N+1 & Skeletons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chat open fast and stop it flashing a false "can't load" screen — by removing a request waterfall, a sequential N+1 on the server, and a `isLoading`-on-a-disabled-query rendering bug, and by giving both chat screens a real skeleton.

**Architecture:** Three independent seams. (1) `backend/src/services/chat.services.ts` batches its member lookup and parallelizes the history payload — response shape unchanged. (2) The frontend group-chat query key drops its `groupId` segment (`campKeys.chat(campId)` = "my group room in this camp"), which lets the chat request fire in parallel with `useMyGroup` instead of after it. (3) The chat screens branch on `isPending` and render a new shared `ChatSkeleton`. Plus a reconnect-backfill fix in the realtime bridge.

**Tech Stack:** Backend — Express 5, Mongoose 9, TypeScript (strict, CommonJS). Frontend — React 19, TanStack Query v5, Zustand, Tailwind v4, `socket.io-client`.

**Spec:** `docs/superpowers/specs/2026-07-27-chat-load-performance-design.md`

## Global Constraints

- **No test runner** — both CLAUDE.md files forbid it. "Verify" = `npm run typecheck` (or `npm run validate`) **plus** the manual runtime check each task names. Never add a test file or a test dependency.
- **Two repos.** `Frontend/` and `Backend/` are separate git repos; the monorepo root is **not** a repo. Commit inside the repo you changed. Mirror plan/spec edits into both `docs/superpowers/`.
- **Backend layering:** `routes → controllers → services → models`. Controllers thin, no try/catch. Business logic in services. Throw `new HttpError(status, message)`.
- **Backend validation:** every input gets a Zod schema in `validators/`; import `z` from `../config/zod`, never `'zod'`. *(No validator changes in this plan — the contract is unchanged.)*
- **Frontend data philosophy:** server data → React Query only, never mirrored into Zustand. Realtime writes **into** the query cache. Zustand is client-owned UI state only.
- **Frontend imports:** use the `@/` alias in files you touch; `import type { … }` for type-only imports (`verbatimModuleSyntax` is on). Convert-as-you-touch — don't mass-rewrite.
- **Never inline a query key.** Every cached resource gets its key from `src/api/queryKeys.ts`.
- **UI primitives:** use `src/components/ui/` (`Skeleton`, `Avatar`, `Button`, …). Don't hand-roll a loading block.
- **Trilingual:** no hard-coded user-facing copy. Every new string ships **UZ / RU / EN** in `src/i18n/translations.ts` — add it to the `ChatStrings` type **and** all three language blocks, or the build fails.
- **Design system:** no rogue colors/fonts/radii; use theme tokens (`bg-canvas`, `bg-surface`, `text-muted`, `bg-line`, `bg-soft`). Dark mode must keep working.
- **Prettier:** no semicolons, single quotes, trailing commas, width 100. Format only files you touch: `npx prettier --write --end-of-line auto <files>`.
- **The response contract does not change in this plan.** If a payload shape changes, you've gone off-spec.

---

## Workstream 1 — Backend latency (independent, ship first)

### Task 1: Batch the member lookup and parallelize the history payload

The dominant server cost of a history load is `membersFrom`, which awaits `UserModel.findById` **inside a for-loop** — one Mongo round-trip per member (30 for a group, up to 100 for the organizers channel). Replace it with a single `$in` query. Then stop the three independent parts of the history payload from running back-to-back.

**Files:**
- Modify: `Backend/src/services/chat.services.ts` (`membersFrom` ~L80-98, `history` ~L104-114, `groupMembers`/`organizerMembers` ~L117-129, `listGroupHistory` ~L131-145, `listOrganizersHistory` ~L147-160)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no signature changes. `membersFrom`, `history`, `listGroupHistory`, `listOrganizersHistory` keep their exact current parameters and return types. This task is invisible to every caller.

- [ ] **Step 1: Record the "before" number**

Seed and start the backend:

```bash
cd Backend && npm run seed:demo && npm run dev
```

Log in as the seeded manager in the browser, copy the `camply_sid` cookie, then time the organizers history (100-ish members is the worst case):

```bash
curl -s -o /dev/null -w 'total: %{time_total}s\n' \
  -b 'camply_sid=<PASTE>' \
  'http://localhost:4000/api/camps/<CAMP_ID>/chat/organizers/messages'
```

Run it three times and write down the best time. You will compare against this in Step 6.

- [ ] **Step 2: Replace the N+1 loop in `membersFrom`**

Replace the whole `membersFrom` function:

```ts
// Project a set of memberships (that carry a bound userId) into ChatMembers.
// ONE query for every user, not one per member — this is a hot path (a group is
// ~30 members, the organizers channel can be 100).
async function membersFrom(
  memberships: { userId?: unknown; role: string }[],
): Promise<ChatMember[]> {
  const bound = memberships.filter((m) => m.userId)
  if (!bound.length) return []

  const users = await UserModel.find({ _id: { $in: bound.map((m) => m.userId) } })
    .select('name surname photo')
    .lean()
  const byId = new Map(users.map((u) => [String(u._id), u]))

  // Input order is preserved; a bound membership whose user row is gone degrades
  // to an empty name, exactly as the old per-id lookup did.
  return bound.map((m) => {
    const u = byId.get(String(m.userId))
    const name = u ? `${u.name ?? ''} ${u.surname ?? ''}`.trim() : ''
    return {
      id: String(m.userId),
      name,
      initials: initialsOf(name),
      color: colorFor(String(m.userId)),
      photo: u?.photo ?? null,
      role: m.role,
    }
  })
}
```

- [ ] **Step 3: Add `.lean()` to the three read queries**

In `history`, `groupMembers`, and `organizerMembers`, add `.lean()` to the Mongoose query. Every one of these is projected to a DTO immediately, so document hydration is pure overhead.

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
      .lean()
    return docs.reverse().map((d) => toChatMessage(d, viewerId))
  },

  // Every membership (any role) in the group room = participants + the coordinator.
  groupMembers: async (campId: Types.ObjectId, groupId: Types.ObjectId): Promise<ChatMember[]> => {
    const rows = await MembershipModel.find({ campId, groupId }).lean()
    return membersFrom(rows)
  },

  // Every organizer-tier membership in the camp (manager + 6 sub-roles).
  organizerMembers: async (campId: Types.ObjectId): Promise<ChatMember[]> => {
    const rows = await MembershipModel.find({
      campId,
      role: { $in: ['manager', ...ORGANIZER_SUB_ROLES] },
    }).lean()
    return membersFrom(rows)
  },
```

- [ ] **Step 4: Fix `toChatMessage`'s type for the lean shape**

`.lean()` returns plain objects, not Mongoose documents. `toChatMessage` currently casts `createdAt` off a document (`(doc as unknown as { createdAt: Date }).createdAt`). Widen its parameter so both a lean object and a hydrated document satisfy it — `postMessage` still passes a real document.

Change the signature only; the body is unchanged:

```ts
// Accepts a hydrated document OR a .lean() plain object — `history` uses lean,
// `postMessage` passes the freshly created document.
type MessageLike = Omit<Message, '_id'> & { _id: Types.ObjectId; createdAt?: Date }

function toChatMessage(doc: MessageLike, viewerId?: string): ChatMessage {
  const createdAt = doc.createdAt as Date
  // …rest of the body unchanged…
}
```

- [ ] **Step 5: Parallelize both history assemblers**

The three awaits inside each object literal are independent but evaluate in order. Run them together:

```ts
  listGroupHistory: async (campId: Types.ObjectId, groupId: Types.ObjectId, viewerId?: string) => {
    // Independent queries — fire them together, don't let the object literal
    // serialize them.
    const [members, messages, othersRead] = await Promise.all([
      chatService.groupMembers(campId, groupId),
      chatService.history(campId, 'group', groupId, viewerId),
      viewerId
        ? chatReadService.othersLastReadAt({
            campId,
            channel: 'group',
            groupId,
            exceptUserId: new Types.ObjectId(viewerId),
          })
        : Promise.resolve(null),
    ])
    return {
      groupId: String(groupId),
      members,
      messages,
      othersLastReadAt: othersRead?.toISOString() ?? null,
    }
  },

  listOrganizersHistory: async (campId: Types.ObjectId, viewerId?: string) => {
    const [members, messages, othersRead] = await Promise.all([
      chatService.organizerMembers(campId),
      chatService.history(campId, 'organizers', null, viewerId),
      viewerId
        ? chatReadService.othersLastReadAt({
            campId,
            channel: 'organizers',
            groupId: null,
            exceptUserId: new Types.ObjectId(viewerId),
          })
        : Promise.resolve(null),
    ])
    return { members, messages, othersLastReadAt: othersRead?.toISOString() ?? null }
  },
```

- [ ] **Step 6: Verify — typecheck, then measure**

```bash
cd Backend && npm run validate
```

Expected: clean. Then restart `npm run dev` and re-run the exact curl from Step 1 three times.

Expected: substantially faster (the member fan-out is now 1 round-trip instead of N). **Write both numbers into the commit message.** If it did not improve, stop and investigate before continuing — that means the bottleneck is elsewhere and the rest of this plan is built on a wrong assumption.

- [ ] **Step 7: Verify the payload is byte-identical**

Compare a response against one captured before the change:

```bash
curl -s -b 'camply_sid=<PASTE>' \
  'http://localhost:4000/api/camps/<CAMP_ID>/chat/group/messages' | python3 -m json.tool
```

Expected: same keys, same member ordering, same `messages` ordering (oldest→newest), same `othersLastReadAt`. This task must not change the contract.

- [ ] **Step 8: Commit**

```bash
cd Backend
npx prettier --write --end-of-line auto src/services/chat.services.ts
git add src/services/chat.services.ts
git commit -m "perf(chat): batch member lookup, parallelize history payload

membersFrom ran UserModel.findById inside a for-loop — one round-trip per
member (30 for a group, ~100 for the organizers channel). Now one \$in query
plus a Map. Also .lean() the three chat reads (all are projected to DTOs
immediately) and Promise.all the three independent parts of each history
payload.

Organizers history on the demo seed: <BEFORE>s -> <AFTER>s.
Response contract unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Workstream 2 — Kill the waterfall (frontend)

### Task 2: Drop the `groupId` segment from the chat query key

`useChat` is gated `enabled: Boolean(groupId)`, so it cannot start until `useMyGroup` resolves — a serial third hop. But `GET /camps/:id/chat/group/messages` derives the room from `req.membership` and *returns* `groupId`; the client never needed it first. Removing the segment lets the request fire in parallel.

**This task touches all three call sites at once and must not be split.** A half-applied key change silently splits the cache: realtime messages append to a key nothing reads, and the thread looks frozen.

**Files:**
- Modify: `Frontend/src/api/queryKeys.ts:109`
- Modify: `Frontend/src/api/queries/chat.queries.ts:9-15`
- Modify: `Frontend/src/store/useChatStore.ts:16-22,48-64`
- Modify: `Frontend/src/api/realtime/realtimeBridge.ts:49-54`
- Modify: `Frontend/src/components/participant/chat/MessageList.tsx:6-17,25-33,81`
- Modify: `Frontend/src/components/participant/chat/ChatScreen.tsx:30,141-149`
- Modify: `Frontend/src/components/organizer/chat/OrgChatScreen.tsx:45`

**Interfaces:**
- Consumes: nothing from Task 1 (independent repo).
- Produces:
  - `campKeys.chat(campId: string)` — one segment shorter.
  - `useChat(campId: string, options?: { enabled?: boolean })`.
  - `useChatStore.toggleReaction(campId, channel, messageId, emoji)` — the `groupId` parameter is gone.
  - `MessageList` no longer takes a `groupId` prop.
  - Task 3 and Task 4 build on these signatures.

- [ ] **Step 1: Change the key factory**

`Frontend/src/api/queryKeys.ts` — replace the `chat` entry:

```ts
  /*
    "My group room in this camp." The server derives the room from the caller's
    membership, so the client never names a group — and a user is only ever
    joined to ONE group room per camp, so one key can't collide. The organizer's
    coordinator chat is this same room from this same endpoint.
  */
  chat: (campId: string) => [...campKeys.all(campId), 'chat'] as const,
```

- [ ] **Step 2: Give `useChat` an explicit `enabled` option**

`Frontend/src/api/queries/chat.queries.ts` — replace `useChat`:

```ts
/*
  The group chat: participants AND the group's coordinator share this exact cache
  entry (same room server-side). Realtime chat:message appends here via setQueryData.

  It deliberately does NOT wait on useMyGroup — the server resolves the room from
  the caller's membership and returns `groupId` in the payload, so gating on a
  client-known groupId only added a serial round-trip. Pass `enabled: false` when
  the caller knows it has no group room (a non-coordinator organizer).
*/
export function useChat(campId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: campKeys.chat(campId),
    queryFn: () => chatService.groupHistory(campId),
    enabled: Boolean(campId) && (options?.enabled ?? true),
  })
}
```

- [ ] **Step 3: Drop `groupId` from `toggleReaction`**

`Frontend/src/store/useChatStore.ts` — the key is now chosen by `channel` alone. Update the type:

```ts
type ChatState = {
  sendText: (campId: string, groupId: string, text: string, replyToId?: string) => void
  toggleReaction: (
    campId: string,
    channel: 'group' | 'organizers',
    messageId: string,
    emoji: string,
  ) => void
}
```

and the implementation's signature + key line:

```ts
  toggleReaction: (campId, channel, messageId, emoji) => {
    const key = channel === 'group' ? campKeys.chat(campId) : campKeys.chatOrganizers(campId)
```

The rest of the function body (the `setQueryData` optimistic flip and the `chat:react` emit) is unchanged.

- [ ] **Step 4: Update the realtime bridge's `keyFor`**

`Frontend/src/api/realtime/realtimeBridge.ts`:

```ts
/*
  The cache key for a room's history, or null if we're not connected to a camp.
  The event's groupId is intentionally ignored here — a socket is only ever joined
  to its own group room, so 'group' always means MY group room. groupId is still
  used for the per-room unread key (roomKey), which is a different concern.
*/
function keyFor(channel: 'group' | 'organizers', _groupId: string | null) {
  if (!currentCampId) return null
  return channel === 'group' ? campKeys.chat(currentCampId) : campKeys.chatOrganizers(currentCampId)
}
```

Leave every `roomKey(evt.channel, evt.groupId)` call exactly as it is — the unread badge is deliberately per-room.

- [ ] **Step 5: Drop the `groupId` prop from `MessageList`**

`Frontend/src/components/participant/chat/MessageList.tsx` — remove `groupId` from the `Props` type and the destructured parameters, and update the reaction call:

```ts
            onToggleReaction={(emoji) => toggleReaction(campId, 'group', m.id, emoji)}
```

- [ ] **Step 6: Update both screens' call sites**

`ChatScreen.tsx` line 30 → `const { data, isPending, isError } = useChat(campId)`.
Remove `groupId={groupId}` from the `<MessageList …>` props.

`OrgChatScreen.tsx` line 45 → gate on coordinator status so a non-coordinator organizer doesn't issue a request it would discard:

```ts
  const { data: groupData } = useChat(campId, { enabled: isCoordinator })
```

`OrgChatScreen` also calls `toggleReaction`; find each call and drop its `groupId` argument.

> `ChatScreen` still references `groupId` for `sendText`. Leave that alone for now — Task 3 re-points it at `data.groupId`. Getting a transient type error here is expected until Task 3; if `npm run typecheck` complains about `groupId` in `ChatScreen`, that's the next task's job.

- [ ] **Step 7: Verify — grep for stragglers**

```bash
cd Frontend && grep -rn "campKeys.chat(" src/
```

Expected: exactly three call sites (`chat.queries.ts`, `useChatStore.ts`, `realtimeBridge.ts`), **all single-argument**. Any two-argument call is a bug that will silently split the cache.

```bash
npm run typecheck
```

Expected: clean, except possibly `ChatScreen`'s `groupId` (resolved in Task 3).

- [ ] **Step 8: Verify — live send still works (this is the real gate)**

Start both servers. Open two browsers (normal + incognito) logged in as two participants **in the same group**. Send from A.

Expected: it appears in B **with no refresh**, and in A's own thread. This is what proves the key change landed in all three places. If B doesn't update, `keyFor` and `useChat` disagree — go back to Steps 2 and 4.

Also tap a reaction and confirm it persists across a reload (proves Step 3's key).

- [ ] **Step 9: Commit**

```bash
cd Frontend
npx prettier --write --end-of-line auto src/api/queryKeys.ts src/api/queries/chat.queries.ts src/store/useChatStore.ts src/api/realtime/realtimeBridge.ts src/components/participant/chat/MessageList.tsx src/components/participant/chat/ChatScreen.tsx src/components/organizer/chat/OrgChatScreen.tsx
git add -A
git commit -m "perf(chat): drop groupId from the chat query key to kill a waterfall

useChat was gated enabled: Boolean(groupId), so it couldn't start until
useMyGroup resolved — a serial third hop. The server already derives the room
from req.membership and returns groupId in the payload, so the gate encoded a
client assumption the server contradicts.

campKeys.chat(campId) now reads as 'my group room in this camp'. A user is
only ever joined to one group room per camp, so one key can't collide, and
the organizer's coordinator chat is the same room from the same endpoint.
useChat takes an explicit { enabled } instead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Workstream 3 — The phantom error screen + skeletons

### Task 3: Add `ChatSkeleton` and fix the loading/error branches

`ChatScreen` branches on `isLoading`, which is **always false for a disabled query** (`isLoading === isPending && isFetching`; a disabled query is pending but not fetching). Control fell through to `if (isError || !data)` and rendered `t.chat.loadError` on every cold open. Task 2 removed the gate, but the branch is still wrong and will misfire again the moment anything else disables the query — fix the branch, not just its trigger.

**Files:**
- Create: `Frontend/src/components/participant/chat/ChatSkeleton.tsx`
- Modify: `Frontend/src/components/participant/chat/ChatScreen.tsx:30,78-107,126-129`
- Modify: `Frontend/src/components/organizer/chat/OrgChatScreen.tsx:104-110`
- Modify: `Frontend/src/i18n/translations.ts` (`ChatStrings` type ~L216-239; `uz` ~L1103, `ru` ~L1688, `en` ~L2260)

**Interfaces:**
- Consumes: `useChat(campId, options?)` from Task 2.
- Produces: `<ChatSkeleton />` — no props; used by both chat screens. New i18n key `chat.noGroupYet`.

- [ ] **Step 1: Create the skeleton**

`Frontend/src/components/participant/chat/ChatSkeleton.tsx`. Widths and spacing mirror `MessageList`'s real layout (`gap-2.5 p-3.5`) so there's no jump when real content swaps in.

```tsx
import { Skeleton } from '@/components/ui'

// Alternating bubble widths — irregular on purpose, so it reads as a
// conversation rather than a loading bar.
const BUBBLES: { mine: boolean; width: string }[] = [
  { mine: false, width: 'w-3/5' },
  { mine: true, width: 'w-2/5' },
  { mine: false, width: 'w-4/5' },
  { mine: false, width: 'w-1/2' },
  { mine: true, width: 'w-3/5' },
  { mine: false, width: 'w-2/3' },
]

/*
  The chat loading state, shared by the participant and organizer threads.
  Mirrors MessageList's layout (same gap/padding rhythm) so the swap to real
  messages doesn't shift anything. ReadyProduct §9 wants a loading state on
  every screen; this is chat's.
*/
export function ChatSkeleton() {
  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* Header: identity tile + two lines of text */}
      <div className="flex items-center gap-3 border-b border-line p-3.5">
        <Skeleton className="size-11 shrink-0 rounded-2xl" tone="surface" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/4" tone="soft" />
        </div>
      </div>

      {/* Thread */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-hidden p-3.5">
        {BUBBLES.map((b, i) => (
          <div key={i} className={`flex ${b.mine ? 'justify-end' : 'justify-start'}`}>
            <Skeleton className={`h-11 ${b.width} rounded-2xl`} tone="surface" />
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2 border-t border-line p-3.5">
        <Skeleton className="size-9 shrink-0 rounded-full" tone="soft" />
        <Skeleton className="h-9 flex-1 rounded-full" tone="surface" />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Export it from the chat folder's neighbours' style**

There is no barrel in `components/participant/chat/` — the screens import siblings directly. Import it in `ChatScreen.tsx` as `import { ChatSkeleton } from './ChatSkeleton'`, and in `OrgChatScreen.tsx` as `import { ChatSkeleton } from '@/components/participant/chat/ChatSkeleton'` (cross-surface sharing, same as `GroupPhotoButton`).

- [ ] **Step 3: Add the `chat.noGroupYet` string in all three languages**

Removing the `groupId` gate exposes a state that was previously unreachable: a participant with no group assignment now gets a real `200` with `groupId: null`. They must not see the generic empty-thread copy ("be the first to say hi") for a room they aren't in.

In the `ChatStrings` type (~L228, beside `emptyThread`):

```ts
  emptyThread: string
  noGroupYet: string // shown when the participant has no group assignment yet
  loading: string
  loadError: string
```

Then add the value to each language block, next to `emptyThread`:

- `uz` (~L1116): `noGroupYet: 'Siz hali guruhga biriktirilmagansiz. Tashkilotchi sizni guruhga qoʻshgach, chat shu yerda paydo boʻladi.',`
- `ru` (~L1701): `noGroupYet: 'Вы ещё не добавлены в группу. Как только организатор добавит вас, чат появится здесь.',`
- `en` (~L2273): `noGroupYet: 'You are not in a group yet. Once an organizer adds you, your group chat appears here.',`

- [ ] **Step 4: Fix `ChatScreen`'s branches**

Replace the `isLoading` / `isError || !data` block (~L78-92):

```tsx
  // isPending, NOT isLoading: isLoading is (isPending && isFetching), so it stays
  // false forever for a disabled query and the error branch below would win on a
  // cold open. isError is the only error signal — a bare !data never is.
  if (isPending) return <ChatSkeleton />

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas px-8 text-center text-body text-muted">
        {t.chat.loadError}
      </div>
    )
  }
```

- [ ] **Step 5: Source `groupId` from server truth**

Still in `ChatScreen`, after the guards `data` is defined. Replace the `groupId` derived from `useMyGroup` with the server's own answer, and handle the unassigned state:

```tsx
  // The server resolves the room from my membership and tells me which group it
  // was — that's the authority, not the useMyGroup card.
  const groupId = data.groupId ?? ''

  // No group assignment yet: a valid state, not an error and not an empty thread.
  if (!groupId) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas px-8 text-center text-body text-muted">
        {t.chat.noGroupYet}
      </div>
    )
  }
```

Delete the now-unused `const groupId = myGroup?.id ?? ''` at line 29. `useMyGroup` is still needed — the header's name/photo come from it.

- [ ] **Step 6: Swap the organizer screen's placeholder**

`OrgChatScreen.tsx` ~L104: the `…` placeholder becomes the skeleton.

```tsx
  if (!campId || orgPending) return <ChatSkeleton />
```

- [ ] **Step 7: Verify — typecheck**

```bash
cd Frontend && npm run validate
```

Expected: clean. A missing language key fails the build — that's the trilingual guardrail working.

- [ ] **Step 8: Verify — the phantom error is gone**

DevTools → Network → throttle to **Slow 3G**. Hard-reload the participant Chat tab.

Expected: `ChatSkeleton` appears, then real messages. **`t.chat.loadError` must never flash.** Repeat 3 times.

- [ ] **Step 9: Verify — the waterfall is gone**

DevTools → Network, filter XHR, reload the Chat tab. Look at the waterfall bars for `my-group` and `chat/group/messages`.

Expected: they **start at the same time**, overlapping — not one beginning after the other finishes.

- [ ] **Step 10: Verify — the remaining states**

- **Unassigned participant:** log in as a participant with no group (or clear one membership's `groupId` in Mongo). Expected: `chat.noGroupYet`, not an error, not "be the first to say hi".
- **Real error:** stop the backend, reload Chat. Expected: `chat.loadError`.
- **Non-coordinator organizer:** open `/org` chat, Network tab. Expected: **no** `chat/group/messages` request. Switch to a coordinator account: the request fires and their group thread renders.
- **Dark mode:** toggle it on the skeleton (throttle to see it). Expected: tokens resolve, no white flash.

- [ ] **Step 11: Commit**

```bash
cd Frontend
npx prettier --write --end-of-line auto src/components/participant/chat/ChatSkeleton.tsx src/components/participant/chat/ChatScreen.tsx src/components/organizer/chat/OrgChatScreen.tsx src/i18n/translations.ts
git add -A
git commit -m "fix(chat): stop flashing 'can't load' on a cold open; add ChatSkeleton

ChatScreen branched on isLoading, which is (isPending && isFetching) — always
false for a disabled query. Every cold open fell through to the
'isError || !data' branch and rendered loadError. Now: isPending -> skeleton,
isError -> error, and a bare !data is never an error.

groupId now comes from the history payload (server truth) instead of
useMyGroup, which also surfaces a state the old gate hid: an unassigned
participant gets chat.noGroupYet (EN/UZ/RU) rather than a permanent error.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Workstream 4 — Reconnect backfill

### Task 4: Refetch history on socket reconnect

`connectRealtime`'s `connect` handler re-joins the room on every reconnect but never refetches. Messages sent while the socket was down are silently missing until a full remount — a correctness bug on the weak networks camps run on.

**Files:**
- Modify: `Frontend/src/api/realtime/realtimeBridge.ts:85-98`

**Interfaces:**
- Consumes: `campKeys.chat(campId)` from Task 2.
- Produces: nothing new. Module-local `hasConnectedOnce` flag, reset by `connectRealtime`/`disconnectRealtime`.

- [ ] **Step 1: Add the reconnect flag and invalidate**

The first `connect` must **not** invalidate — the screen's own mount fetch is already in flight, and invalidating would double-fetch on every launch. Only a *re*-connect is a backfill.

In `Frontend/src/api/realtime/realtimeBridge.ts`, add beside the other module state (near `let socket` / `let currentCampId`):

```ts
// 'connect' fires on the first connection AND every reconnect. Only a RECONNECT
// needs a history backfill — on the first one the screen's own fetch is already
// in flight, and invalidating would double-fetch every launch.
let hasConnectedOnce = false
```

Replace the `connect` handler inside `connectRealtime`:

```ts
  // Fires on first connect AND every reconnect — re-join the room each time so a
  // dropped connection self-heals without a page refresh.
  socket.on('connect', () => {
    socket?.emit('chat:connectCamp', { campId })

    // Re-joining restores DELIVERY, not CONTENT: anything sent while we were
    // down was broadcast to a room we weren't in. Refetch both threads so the
    // gap fills itself.
    if (hasConnectedOnce) {
      void queryClient.invalidateQueries({ queryKey: campKeys.chat(campId) })
      void queryClient.invalidateQueries({ queryKey: campKeys.chatOrganizers(campId) })
    }
    hasConnectedOnce = true
  })
```

- [ ] **Step 2: Reset the flag on teardown**

A new camp connection is a fresh first-connect. In `connectRealtime`, right after `currentCampId = campId`:

```ts
  currentCampId = campId
  hasConnectedOnce = false
```

and in `disconnectRealtime`:

```ts
export function disconnectRealtime() {
  socket?.disconnect()
  socket = null
  currentCampId = null
  hasConnectedOnce = false
}
```

- [ ] **Step 3: Verify — typecheck**

```bash
cd Frontend && npm run validate
```

Expected: clean.

- [ ] **Step 4: Verify — no double-fetch on first launch**

DevTools → Network (XHR), hard-reload the Chat tab.

Expected: **exactly one** `chat/group/messages` request. If you see two, the `hasConnectedOnce` guard is inverted.

- [ ] **Step 5: Verify — the backfill actually works**

Two sessions, A and B, same group. In B: DevTools → Network → **Offline**. From A, send two messages. Back in B, set Network to **No throttling**.

Expected: B's socket reconnects and both messages appear **without a refresh**. Before this task they would have been missing until remount.

- [ ] **Step 6: Commit**

```bash
cd Frontend
npx prettier --write --end-of-line auto src/api/realtime/realtimeBridge.ts
git add src/api/realtime/realtimeBridge.ts
git commit -m "fix(chat): backfill history on socket reconnect

The connect handler re-joined rooms but never refetched, so messages sent
while the socket was down stayed missing until a full remount. Re-joining
restores delivery, not content. Guarded by hasConnectedOnce so the first
connect doesn't double-fetch alongside the screen's own mount fetch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Docs update (do last, in the same effort)

### Task 5: Update both CLAUDE.md files

Both repos require their CLAUDE.md to be updated in the same change as any cross-cutting pattern shift. Two things changed that a future agent will get wrong otherwise: the chat query key shape, and the `isPending`-not-`isLoading` rule.

**Files:**
- Modify: `Frontend/CLAUDE.md` (the `api/realtime/realtimeBridge.ts` bullet under *Backend boundary*)
- Modify: `Backend/CLAUDE.md` (the `chatService` bullet under *Realtime chat*)

- [ ] **Step 1: Frontend — document the key change and the branch rule**

Append to the chat liveness sub-bullet in `Frontend/CLAUDE.md`:

```markdown
  - **Chat load performance (2026-07-27):** the group-chat key lost its `groupId`
    segment — **`campKeys.chat(campId)`**, read as *"my group room in this camp"*
    (the server derives the room from membership and returns `groupId` in the
    payload; a socket is only ever in one group room per camp). `useChat(campId,
    { enabled })` no longer waits on `useMyGroup` — that gate was a serial third
    round-trip. **Branch chat queries on `isPending`, never `isLoading`**:
    `isLoading` is `isPending && isFetching`, so it is permanently false for a
    disabled query, and `if (isError || !data)` then renders an error on every
    cold open — that was the "can't load" flash. `isError` is the only error
    signal. `ChatSkeleton` (in `participant/chat/`) is shared by both chat
    screens. The bridge's `connect` handler now invalidates both chat keys on a
    **re**connect (`hasConnectedOnce`) to backfill messages missed while down.
    Design/plan: `docs/superpowers/{specs,plans}/2026-07-27-chat-load-performance*.md`.
```

- [ ] **Step 2: Backend — document the batching rule**

Append to the `chatService` bullet in `Backend/CLAUDE.md`'s *Realtime chat* section:

```markdown
  **Member projection is batched (2026-07-27):** `membersFrom` does ONE
  `UserModel.find({_id:{$in:…}}).select(…).lean()` plus a Map — it used to run
  `findById` inside a `for` loop (one round-trip per member; ~100 on the
  organizers channel). All three chat reads are `.lean()` (everything is
  projected to a DTO immediately), and both `list*History` assemblers wrap their
  three independent queries in `Promise.all` instead of letting the object
  literal serialize them. Response contract unchanged. Design/plan:
  `docs/superpowers/{specs,plans}/2026-07-27-chat-load-performance*.md`.
```

- [ ] **Step 3: Mirror this plan and its spec into both repos**

```bash
cd /Users/mn.afridi/Desktop/Camply
cp Frontend/docs/superpowers/plans/2026-07-27-chat-load-performance.md Backend/docs/superpowers/plans/
cp Frontend/docs/superpowers/specs/2026-07-27-chat-load-performance-design.md Backend/docs/superpowers/specs/
```

- [ ] **Step 4: Commit in both repos**

```bash
cd Frontend && git add CLAUDE.md docs/ && git commit -m "docs: record chat load-performance changes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"

cd ../Backend && git add CLAUDE.md docs/ && git commit -m "docs: record chat member-projection batching

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review (completed during authoring)

**Spec coverage** — every section of `2026-07-27-chat-load-performance-design.md` maps to a task:

| Spec item | Task |
|---|---|
| N+1 in `membersFrom` | 1 (Step 2) |
| `.lean()` on chat reads | 1 (Steps 3–4) |
| `Promise.all` in both history assemblers | 1 (Step 5) |
| `campKeys.chat(campId)` key change | 2 (Step 1) |
| `useChat` explicit `enabled` | 2 (Step 2) |
| `toggleReaction` / `MessageList` groupId removal | 2 (Steps 3, 5) |
| `keyFor` update | 2 (Step 4) |
| `isPending` / `isError` branches | 3 (Step 4) |
| `ChatSkeleton` | 3 (Steps 1–2, 6) |
| `chat.noGroupYet` EN/UZ/RU | 3 (Steps 3, 5) |
| `OrgChatScreen` `enabled: isCoordinator` | 2 (Step 6) |
| Reconnect backfill + first-connect guard | 4 |
| CLAUDE.md updates | 5 |
| All 8 spec verification items | 1.6–1.7, 2.8, 3.8–3.10, 4.4–4.5 |

**Placeholder scan** — no TBD/TODO. Every code step carries real code. The one intentional "figure it out" is Task 1 Step 6's *"if it did not improve, stop and investigate"* — that's a deliberate gate, not a gap.

**Type consistency** — `campKeys.chat(campId)` is single-argument in Tasks 2 and 4. `toggleReaction(campId, channel, messageId, emoji)` is consistent between the type (2.3), the impl (2.3), and both call sites (2.5, 2.6). `useChat(campId, options?)` matches across 2.2, 2.6, and 3.4. `ChatSkeleton` takes no props in 3.1, 3.4, and 3.6.

**Known ordering dependency** — Task 2 Step 6 leaves `ChatScreen` with a dangling `groupId` reference that Task 3 Step 5 resolves. This is called out inline in Task 2 so an implementer reading tasks out of order isn't surprised. Task 2's own typecheck (2.7) is documented as possibly non-clean for exactly this reason; Task 3's (3.7) is the real gate.

**Copy review** — the three `noGroupYet` strings are the only new user-facing copy.
A native UZ/RU reader should still sanity-check them; see the note below.

---

## Execution notes (2026-07-27, added while implementing)

Three things differed from the plan as written. Recorded so the next reader
isn't misled by the steps above.

1. **Task 3 Step 5 was wrong about where `groupId` goes.** The plan says to
   declare `const groupId = data.groupId ?? ''` *after* the loading/error guards.
   That doesn't compile: the unread-room `useEffect` (`ChatScreen.tsx` ~L69)
   references `groupId` and runs *before* the guards, so TS reports
   "Block-scoped variable used before its declaration." It is declared
   immediately after the `useChat` call instead, as `data?.groupId ?? ''` —
   optional because it is read while `data` may still be undefined. The
   `if (!groupId)` → `chat.noGroupYet` branch stays after the guards as planned.

2. **The `isPending`/`isError` branch fix moved from Task 3 into Task 2.** The
   plan expected Task 2 to leave a transient type error for Task 3 to resolve.
   It can't: `npm run validate` (which includes `tsc`) is the **pre-commit
   hook**, so a commit that doesn't typecheck cannot be made. Task 2 therefore
   fixed the branch condition and kept the old `t.chat.loading` text; Task 3
   swapped that text for `<ChatSkeleton />` and added `chat.noGroupYet`. Each
   commit typechecks on its own. *(A plan for a repo with a validating
   pre-commit hook can't schedule a knowingly-broken intermediate commit.)*

3. **The N+1 was far worse than the plan assumed, for a reason the plan
   missed.** `MONGO_URI` is `mongodb+srv://` — a remote Atlas cluster — so each
   loop iteration paid a ~180ms network round-trip rather than a sub-millisecond
   local lookup. Measured on the demo seed, best of 5:

   | endpoint | members | before | after |
   |---|---|---|---|
   | `chat/organizers/messages` | 11 | 2.15s | 0.90s |
   | `chat/group/messages` | 8 | 1.74s | 0.83s |

   Both payloads verified byte-identical before/after.

**Still owed — manual browser verification.** Everything checkable without a
browser was checked (typecheck, production build, byte-identical payloads, a
lean-projection probe covering reactions + `replyTo`, and a two-socket probe
proving both live delivery and the reconnect gap). These need a human at a
browser: the Slow-3G skeleton-not-error check (3.8), the overlapping-XHR
waterfall check (3.9), dark mode on the skeleton (3.10), the single-request
check on first launch (4.4), and a native UZ/RU read of the three `noGroupYet`
strings.

**Known follow-up, out of scope here.** After this work the history endpoints
still take ~0.9s, and the remaining cost is *not* in chat: it is the
`requireAuth` → `requireCampMember` middleware chain, which runs ~4 sequential
queries (session, user, camp, membership) before the handler starts. At ~180ms
each on a remote DB that is the new dominant term. Batching or caching that
chain would benefit **every** authenticated endpoint, not just chat. A native UZ/RU reader should sanity-check them before merge; the meaning to preserve is *"you have no group yet; the chat appears once an organizer adds you"* — not an error, not an apology.
