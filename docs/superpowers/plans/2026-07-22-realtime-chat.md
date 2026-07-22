# Realtime Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist chat messages, deliver them live over Socket.IO, and give a coordinator's group assignment a real backend home — flipping the frontend's mock chat to real with no UI rewrite.

**Architecture:** Backend adds a `Message` model, two camp-scoped REST history routes, and a Socket.IO layer (cookie-auth handshake, server-derived room membership, `chat:send`/`chat:message`/`chat:presence`/`chat:error` events). The "group" room is shared between a group's participants and its coordinator — one conversation, one cache entry. Frontend migrates `lib/chat.ts` → `api/services|queries`, flips `orgChat.service` mock → real, turns `realtimeBridge` into a real Socket.IO client, and converts sending to an optimistic-append-over-socket flow.

**Tech Stack:** Backend — Express 5, Mongoose 9, Zod 4, `socket.io`, TypeScript (CommonJS, strict). Frontend — React 19, Vite, TanStack Query, Zustand, `socket.io-client`, TypeScript (strict, `@/` alias).

**Repos:** This is a cross-repo feature. Backend tasks (B1–B11) run in `camply-backend`; frontend tasks (F1–F9) run in `camply-frontend`. **Do backend first** — it defines the wire contract the frontend consumes. This plan file is mirrored into both repos under `docs/superpowers/plans/`.

## Global Constraints

- **No test runner** (both repos, project preference — CLAUDE.md). Do **not** add or suggest a test framework. Each task's "test cycle" is: **`npm run typecheck`** (backend) / **`npm run validate`** (frontend) must pass, plus the task's stated **manual** check (curl / socket client / browser). Evidence before "done."
- **Layering (backend):** `routes → controllers → services → models`; the socket layer follows `sockets → handlers → services → models`. Controllers/handlers are thin (no try/catch — Express 5 forwards async throws). Business logic in services. Throw `new HttpError(status, message)`.
- **Import `z` from `config/zod`** (never `'zod'`) so `.openapi()` metadata attaches.
- **Env** goes through `config/env.ts` (never read `process.env` elsewhere).
- **Server is the sole authority.** A participant socket must never be able to request the `organizers` room. Rooms are derived from the DB, never named by the client. `channel: 'group'` sends re-derive `groupId` server-side — never trust a client-sent `groupId`.
- **Frontend:** server data → React Query only (never mirror into Zustand). Query keys come from `api/queryKeys.ts` (never inline `['...']`). Use `import type` for type-only imports (`verbatimModuleSyntax` is on). Tokens/`@/` alias per CLAUDE.md.
- **Trilingual by default** — every new string ships EN/UZ/RU in `translations.ts`; no hard-coded copy.
- **Text only.** No attachments, reactions, read receipts, or typing indicators server-side. `text` is trimmed, 1..2000 chars.
- **Commit after each task** with a clear message. Both repos have a `validate` pre-commit hook — it must pass.

---

# PART 1 — BACKEND (`camply-backend`)

**File structure (backend):**
- Create: `src/models/message.model.ts` — the `Message` schema.
- Create: `src/validators/chat.validators.ts` — Zod schema for message text + params.
- Create: `src/services/chat.services.ts` — `postMessage`, `listGroupHistory`, `listOrganizersHistory`, member projections. Single source of truth for both REST + socket.
- Create: `src/controllers/chat.controllers.ts` — thin REST history handlers.
- Create: `src/routes/chat.routes.ts` — the two history routes, mounted on `campRouter`.
- Create: `src/sockets/index.ts` — `attachSockets(httpServer)`: creates the `io`, installs the handshake-auth middleware, registers the connection handler.
- Create: `src/sockets/auth.ts` — cookie-parse + session lookup handshake middleware.
- Create: `src/sockets/chat.handlers.ts` — room derivation, `chat:connectCamp`, `chat:send`, presence.
- Modify: `src/app.ts` — export the raw `http.Server` alongside the Express app (Socket.IO needs the raw server).
- Modify: `src/server.ts` — attach sockets to the server before `listen`.
- Modify: `src/models/membership.model.ts` — widen `groupId`'s doc comment (dual meaning).
- Modify: `src/validators/team.validators.ts` — optional `groupId` on invite; new group-reassign schema.
- Modify: `src/services/team.services.ts` — accept `groupId` on invite; new `setCoordinatorGroup`.
- Modify: `src/controllers/team.controllers.ts` + `src/routes/team.routes.ts` — pass `groupId`; new PATCH route.
- Modify: `src/services/organizer.services.ts` (or `camp.services.ts`) — `my-role` projection.
- Modify: `src/routes/me.routes.ts` **or** `camp.routes.ts` — the `my-role` route.
- Modify: `src/routes/index.ts` — mount chat routes on `campRouter`.
- Modify: `src/docs/openapi.ts` — register the new REST paths.

---

### Task B1: Add `socket.io` and expose the raw HTTP server

**Files:**
- Modify: `package.json` (add dep)
- Modify: `src/app.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Produces: `createApp()` unchanged (returns the Express app). New `src/server.ts` wraps it in `http.createServer(app)` and passes that server to `attachSockets` (added in B6) before `listen`.

- [ ] **Step 1: Install socket.io**

```bash
cd /Users/mn.afridi/Desktop/Camply/Backend
npm install socket.io
```

- [ ] **Step 2: Wrap the Express app in a raw HTTP server in `server.ts`**

Socket.IO needs the raw `http.Server`, not the Express app. Rewrite `src/server.ts`:

```ts
import { createServer } from 'node:http'
import { createApp } from './app'
import { attachSockets } from './sockets'
import { connectDB } from './config/db'
import { env } from './config/env'

async function bootstrap() {
  await connectDB()

  const app = createApp()
  const server = createServer(app)
  attachSockets(server) // Socket.IO shares the same HTTP server as Express

  server.listen(env.PORT, () => {
    console.log(`🚀 Server running on http://localhost:${env.PORT} (${env.NODE_ENV})`)
  })
}

bootstrap()
```

> `attachSockets` does not exist yet — B6 creates it. Until then, `typecheck` will fail on that import. Create a **temporary stub** now so B1 typechecks in isolation, then B6 fills it in:

- [ ] **Step 3: Create a stub `src/sockets/index.ts`**

```ts
import type { Server as HttpServer } from 'node:http'

// Stub — replaced in Task B6 with the real Socket.IO wiring.
export function attachSockets(_server: HttpServer): void {}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes (no errors).

- [ ] **Step 5: Manual — boot the server**

Run: `npm run dev`
Expected: `🚀 Server running on http://localhost:4000`. `GET http://localhost:4000/api/health` still returns `{ status: 'ok', ... }`. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/server.ts src/sockets/index.ts
git commit -m "chore(chat): add socket.io and serve Express via raw http server"
```

---

### Task B2: The `Message` model

**Files:**
- Create: `src/models/message.model.ts`

**Interfaces:**
- Produces: `MessageModel`, `type Message`, `MESSAGE_CHANNELS = ['group', 'organizers'] as const`.

- [ ] **Step 1: Create the model**

```ts
import { Schema, model, Types, type InferSchemaType } from 'mongoose'

export const MESSAGE_CHANNELS = ['group', 'organizers'] as const
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number]

const messageSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true },
    channel: { type: String, enum: MESSAGE_CHANNELS, required: true },
    // Required + non-null iff channel === 'group'; null for the organizers room.
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
  },
  { timestamps: true },
)

// History load is always "latest N for this exact room" — this is that query shape.
messageSchema.index({ campId: 1, channel: 1, groupId: 1, createdAt: 1 })

export type Message = InferSchemaType<typeof messageSchema> & { _id: Types.ObjectId }
export const MessageModel = model('Message', messageSchema)
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/models/message.model.ts
git commit -m "feat(chat): add Message model"
```

---

### Task B3: Chat validators (text schema + params)

**Files:**
- Create: `src/validators/chat.validators.ts`

**Interfaces:**
- Produces: `messageTextSchema` (`z.object({ text })`), `sendMessageSchema` (socket payload: `{ campId, channel, text }`), `campIdParam` re-exported for the routes (reuse the existing one from `camp.validators`).

- [ ] **Step 1: Create the validators**

```ts
import { z } from '../config/zod'
import { MESSAGE_CHANNELS } from '../models/message.model'

// The one text rule, shared by REST (none today) and the socket send handler.
export const messageTextSchema = z
  .string()
  .trim()
  .min(1, 'Message cannot be empty')
  .max(2000, 'Message too long')

// Socket chat:send payload. groupId is deliberately absent — the server re-derives
// it from the caller's membership; a client-sent group is never trusted.
export const sendMessageSchema = z.object({
  campId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid campId'),
  channel: z.enum(MESSAGE_CHANNELS),
  text: messageTextSchema,
})

export type SendMessageInput = z.infer<typeof sendMessageSchema>
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/validators/chat.validators.ts
git commit -m "feat(chat): add message text + send-payload validators"
```

---

### Task B4: `chat.services.ts` — the single source of truth

**Files:**
- Create: `src/services/chat.services.ts`

**Interfaces:**
- Consumes: `MessageModel`, `MembershipModel`, `ORGANIZER_SUB_ROLES`, `UserModel`, `GroupModel`, `colorFor`/`initialsOf` from `utils/avatar`.
- Produces (all used by REST controllers B5 **and** socket handlers B7):
  - `toChatMessage(doc): ChatMessage` — projects a `Message` doc to the frontend `ChatMessage` shape.
  - `postMessage({ campId, channel, groupId, authorId, text }): Promise<ChatMessage>` — persists + returns the projected message.
  - `listGroupHistory(campId, groupId): Promise<{ messages, members }>` — latest 50 + the group room's members.
  - `listOrganizersHistory(campId): Promise<{ messages, members }>` — latest 50 + all organizer-tier members.
  - `groupMembers(campId, groupId): Promise<ChatMember[]>`, `organizerMembers(campId): Promise<ChatMember[]>`.
  - `HISTORY_LIMIT = 50`.

- [ ] **Step 1: Create the service**

The `ChatMessage`/`ChatMember` shapes below mirror the frontend `lib/chat.ts` contract (the frontend resolves the author against `members[]`, so messages carry only `authorId`). Time is `HH:MM` for display, matching the mock.

```ts
import { Types } from 'mongoose'
import { MessageModel, type Message, type MessageChannel } from '../models/message.model'
import { MembershipModel, ORGANIZER_SUB_ROLES } from '../models/membership.model'
import { UserModel } from '../models/user.model'
import { initialsOf, colorFor } from '../utils/avatar'

export const HISTORY_LIMIT = 50

// The frontend ChatMessage contract (lib/chat.ts). Text-only server-side: kind is
// always 'text'; sentByMe/status/reactions are resolved/added client-side.
export type ChatMessage = {
  id: string
  authorId: string
  kind: 'text'
  text: string
  time: string // HH:MM
  createdAt: string // ISO — the client can re-derive `time` and ordering
}

export type ChatMember = {
  id: string
  name: string
  initials: string
  color: string
  photo?: string | null
  role: string
}

const hhmm = (d: Date): string => d.toTimeString().slice(0, 5)

function toChatMessage(doc: Message): ChatMessage {
  const createdAt = (doc as unknown as { createdAt: Date }).createdAt
  return {
    id: String(doc._id),
    authorId: String(doc.authorId),
    kind: 'text',
    text: doc.text,
    time: hhmm(createdAt),
    createdAt: createdAt.toISOString(),
  }
}

// Project a set of memberships (that carry a bound userId) into ChatMembers.
async function membersFrom(
  memberships: { userId: unknown; role: string }[],
): Promise<ChatMember[]> {
  const bound = memberships.filter((m) => m.userId)
  const out: ChatMember[] = []
  for (const m of bound) {
    const u = await UserModel.findById(m.userId as Types.ObjectId)
    const name = u ? `${u.name ?? ''} ${u.surname ?? ''}`.trim() : ''
    out.push({
      id: String(m.userId),
      name,
      initials: initialsOf(name),
      color: colorFor(String(m.userId)),
      photo: u?.photo ?? null,
      role: m.role,
    })
  }
  return out
}

export const chatService = {
  toChatMessage,

  // Latest N for an exact room, oldest→newest (the client appends).
  history: async (campId: Types.ObjectId, channel: MessageChannel, groupId: Types.ObjectId | null) => {
    const docs = await MessageModel.find({ campId, channel, groupId })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
    return docs.reverse().map(toChatMessage)
  },

  // Every membership (any role) in the group room = participants + the coordinator.
  groupMembers: async (campId: Types.ObjectId, groupId: Types.ObjectId): Promise<ChatMember[]> => {
    const rows = await MembershipModel.find({ campId, groupId })
    return membersFrom(rows)
  },

  // Every organizer-tier membership in the camp (manager + 6 sub-roles).
  organizerMembers: async (campId: Types.ObjectId): Promise<ChatMember[]> => {
    const rows = await MembershipModel.find({
      campId,
      role: { $in: ['manager', ...ORGANIZER_SUB_ROLES] },
    })
    return membersFrom(rows)
  },

  listGroupHistory: async (campId: Types.ObjectId, groupId: Types.ObjectId) => ({
    groupId: String(groupId),
    members: await chatService.groupMembers(campId, groupId),
    messages: await chatService.history(campId, 'group', groupId),
  }),

  listOrganizersHistory: async (campId: Types.ObjectId) => ({
    members: await chatService.organizerMembers(campId),
    messages: await chatService.history(campId, 'organizers', null),
  }),

  // Persist + project. The one write path both REST (none today) and the socket use.
  postMessage: async (input: {
    campId: Types.ObjectId
    channel: MessageChannel
    groupId: Types.ObjectId | null
    authorId: Types.ObjectId
    text: string
  }): Promise<ChatMessage> => {
    const doc = await MessageModel.create({
      campId: input.campId,
      channel: input.channel,
      groupId: input.channel === 'group' ? input.groupId : null,
      authorId: input.authorId,
      text: input.text,
    })
    return toChatMessage(doc)
  },
}
```

> Note: `UserModel` `name`/`surname` are optional (claimed-but-nameless participants) — hence the `?? ''` guards, matching `team.services.ts`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/services/chat.services.ts
git commit -m "feat(chat): chat service (history, members, postMessage)"
```

---

### Task B5: REST history routes + controllers

**Files:**
- Create: `src/controllers/chat.controllers.ts`
- Create: `src/routes/chat.routes.ts`
- Modify: `src/routes/camp.routes.ts` (mount)

**Interfaces:**
- Consumes: `chatService` (B4), `requireCampMember`/`requireCampManager` (campScope middleware), `req.membership`, `req.camp`.
- Produces: `chatRouter` mounted at `/camps/:id/chat` on `campRouter`. Two GETs:
  - `GET /camps/:id/chat/group/messages` → `{ groupId, members, messages }` (member-level; unassigned → `{ groupId: null, members: [], messages: [] }`).
  - `GET /camps/:id/chat/organizers/messages` → `{ members, messages }` (manager-gated; participant → 403).

- [ ] **Step 1: Create the controllers**

```ts
import type { RequestHandler } from 'express'
import { Types } from 'mongoose'
import { chatService } from '../services/chat.services'

// The caller's OWN group's chat. groupId comes from req.membership — never the URL,
// same structural-privacy pattern as GET /camps/:id/my-group. Unassigned is a valid
// 200 state (empty), not a 403.
export const getGroupMessages: RequestHandler = async (req, res) => {
  const campId = req.camp!._id
  const groupId = req.membership?.groupId
  if (!groupId) {
    res.json({ groupId: null, members: [], messages: [] })
    return
  }
  res.json(await chatService.listGroupHistory(campId, groupId as Types.ObjectId))
}

// The organizers channel — organizer-tier only (requireCampManager gates the route).
export const getOrganizerMessages: RequestHandler = async (req, res) => {
  res.json(await chatService.listOrganizersHistory(req.camp!._id))
}
```

- [ ] **Step 2: Create the router**

`Router({ mergeParams: true })` is mandatory so `:id` is readable by the campScope middleware (per the backend `:id`-reading rule).

```ts
import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware'
import { requireCampMember, requireCampManager } from '../middlewares/campScope.middleware'
import { validate } from '../middlewares/validate.middleware'
import { campIdParam } from '../validators/camp.validators'
import * as c from '../controllers/chat.controllers'

const router = Router({ mergeParams: true })

router.get(
  '/group/messages',
  requireAuth,
  validate({ params: campIdParam }),
  requireCampMember,
  c.getGroupMessages,
)
router.get(
  '/organizers/messages',
  requireAuth,
  validate({ params: campIdParam }),
  requireCampMember,
  requireCampManager,
  c.getOrganizerMessages,
)

export default router
```

- [ ] **Step 3: Mount it on `campRouter`**

In `src/routes/camp.routes.ts`, add the import at the top with the other sub-routers and mount it alongside schedule/announcements/leaderboard:

```ts
import chatRouter from './chat.routes'
```

```ts
campRouter.use('/:id/schedule', scheduleRouter)
campRouter.use('/:id/announcements', announcementRouter)
campRouter.use('/:id/leaderboard', leaderboardRouter)
campRouter.use('/:id/chat', chatRouter) // ← add this line
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 5: Manual — seed + curl**

```bash
npm run seed:demo   # 1 manager, 10 organizers, 100 participants in 10 groups
```

Then boot (`npm run dev`) and, using a browser session cookie (log in via the frontend or copy `camply_sid`), hit the routes. Quick sanity without a cookie:

```bash
curl -s http://localhost:4000/api/camps/000000000000000000000000/chat/group/messages
# Expected: 401 Not authenticated (no cookie) — proves the route is wired + guarded.
```

With a valid participant cookie against their real campId, expect `200 { groupId, members: [...], messages: [] }`. With a participant cookie on the organizers route, expect `403`.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/chat.controllers.ts src/routes/chat.routes.ts src/routes/camp.routes.ts
git commit -m "feat(chat): REST history routes for group + organizers channels"
```

---

### Task B6: Socket.IO server + cookie-auth handshake

**Files:**
- Create: `src/sockets/auth.ts`
- Modify: `src/sockets/index.ts` (replace the B1 stub)

**Interfaces:**
- Consumes: `sessionService.findLive` (existing), `UserModel`, `SESSION_COOKIE_NAME`, `env.CLIENT_ORIGIN`.
- Produces:
  - `socketAuth(socket, next)` — handshake middleware; sets `socket.data.user = { id: string, role: string }` or rejects.
  - `attachSockets(server): Server` — creates `io`, installs `socketAuth`, delegates each connection to `registerChatHandlers` (B7). Exports the `io` singleton via `getIo()` so handlers can emit.

- [ ] **Step 1: Create the handshake auth middleware**

No bearer token exists — the handshake carries the `camply_sid` cookie (same-origin/`withCredentials`). Parse it from the raw header (dependency-free), then run the *identical* checks `requireAuth` does.

```ts
import type { Socket } from 'socket.io'
import { UserModel } from '../models/user.model'
import { sessionService } from '../services/session.services'
import { SESSION_COOKIE_NAME } from '../config/cookies'

// Minimal cookie-header parse — avoids a new dep. Returns the named cookie or null.
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return null
}

// Mirror requireAuth exactly: session must be live AND the user active. Reject the
// HANDSHAKE (not just a room join) so a deactivated account can't hold a live socket.
export async function socketAuth(
  socket: Socket,
  next: (err?: Error) => void,
): Promise<void> {
  try {
    const raw = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE_NAME)
    if (!raw) return next(new Error('Not authenticated'))

    const session = await sessionService.findLive(raw)
    if (!session) return next(new Error('Session expired'))

    const user = await UserModel.findById(session.userId)
    if (!user || !user.active) return next(new Error('Not authenticated'))

    socket.data.user = { id: String(user._id), role: user.role }
    next()
  } catch (err) {
    next(err as Error)
  }
}
```

- [ ] **Step 2: Replace the stub `sockets/index.ts` with the real wiring**

```ts
import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { env } from '../config/env'
import { socketAuth } from './auth'
import { registerChatHandlers } from './chat.handlers'

let io: Server | null = null

export function attachSockets(server: HttpServer): Server {
  io = new Server(server, {
    // Same cross-origin posture as Express CORS — the cookie must ride the handshake.
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  })

  io.use(socketAuth)
  io.on('connection', (socket) => {
    registerChatHandlers(io!, socket)
  })

  return io
}

// Emit from anywhere (handlers) without threading the instance through every call.
export function getIo(): Server {
  if (!io) throw new Error('Socket.IO not initialised')
  return io
}
```

> `registerChatHandlers` does not exist yet — B7 creates it. Add a temporary stub in `src/sockets/chat.handlers.ts` so B6 typechecks:

- [ ] **Step 3: Create a stub `src/sockets/chat.handlers.ts`**

```ts
import type { Server, Socket } from 'socket.io'

// Stub — replaced in Task B7.
export function registerChatHandlers(_io: Server, _socket: Socket): void {}
```

- [ ] **Step 4: Extend the socket data type**

Create `src/sockets/types.ts` so `socket.data` is typed across files:

```ts
import 'socket.io'

declare module 'socket.io' {
  interface SocketData {
    user: { id: string; role: string }
    // Per-camp send authorization, computed on chat:connectCamp (B7).
    byCamp?: Map<string, { groupId: string | null; canOrganizers: boolean }>
  }
}
```

Import it once for its side effect at the top of `src/sockets/index.ts`:

```ts
import './types'
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 6: Manual — handshake auth**

Boot (`npm run dev`). From the browser console on the running frontend (logged in), or a quick node script with the cookie, connect:

```js
// In the browser console at http://localhost:5173 (logged in):
const s = io('http://localhost:4000', { withCredentials: true })
s.on('connect', () => console.log('connected', s.id))
s.on('connect_error', (e) => console.log('rejected:', e.message))
```

Expected: `connected <id>` when logged in; `rejected: Not authenticated` when the cookie is absent/cleared. (Requires `socket.io-client` — for a pure check use the frontend after F1. For now, the typecheck + a logged-in connect is enough.)

- [ ] **Step 7: Commit**

```bash
git add src/sockets/
git commit -m "feat(chat): Socket.IO server with cookie-auth handshake"
```

---

### Task B7: Chat socket handlers — rooms, send, presence

**Files:**
- Modify: `src/sockets/chat.handlers.ts` (replace the B6 stub)

**Interfaces:**
- Consumes: `chatService.postMessage`, `MembershipModel`, `CampModel`, `ORGANIZER_SUB_ROLES`, `sendMessageSchema` (B3), `socket.data.user`.
- Produces: `registerChatHandlers(io, socket)` wiring these events:
  - C→S `chat:connectCamp` `{ campId }` — derive + join entitled rooms, store `socket.data.byCamp`, emit presence.
  - C→S `chat:send` `{ campId, channel, text }` — validate, authorize, persist, broadcast `chat:message`; on failure emit `chat:error`.
  - S→C `chat:message` `{ channel, groupId, message }`.
  - S→C `chat:presence` `{ channel, groupId, onlineUserIds }`.
  - S→C `chat:error` `{ code, message }`.
- Room name helpers: `groupRoom(campId, groupId)` = `group:{campId}:{groupId}`; `orgRoom(campId)` = `organizers:{campId}`.

- [ ] **Step 1: Implement the handlers**

```ts
import type { Server, Socket } from 'socket.io'
import { Types } from 'mongoose'
import { MembershipModel, ORGANIZER_SUB_ROLES } from '../models/membership.model'
import { CampModel } from '../models/camp.model'
import { chatService } from '../services/chat.services'
import { sendMessageSchema } from '../validators/chat.validators'

const groupRoom = (campId: string, groupId: string) => `group:${campId}:${groupId}`
const orgRoom = (campId: string) => `organizers:${campId}`

const isOrganizerTier = (role: string) =>
  role === 'manager' || (ORGANIZER_SUB_ROLES as readonly string[]).includes(role)

// The set of userIds currently connected to a room (in-memory, single-process).
async function onlineUserIds(io: Server, room: string): Promise<string[]> {
  const sockets = await io.in(room).fetchSockets()
  return [...new Set(sockets.map((s) => s.data.user.id))]
}

export function registerChatHandlers(io: Server, socket: Socket): void {
  const user = socket.data.user

  socket.on('chat:connectCamp', async ({ campId }: { campId: string }) => {
    if (!Types.ObjectId.isValid(campId)) return
    const camp = await CampModel.findById(campId)
    if (!camp) return

    // Server-derived entitlements — the client NEVER names a room.
    let groupId: string | null = null
    let canOrganizers = false

    if (user.role === 'organization') {
      // The org super-admin sees any camp in its org; organizers room only.
      if (String(camp.organizationId) === user.id) canOrganizers = true
    } else {
      const membership = await MembershipModel.findOne({ campId, userId: user.id })
      if (membership) {
        if (membership.groupId) {
          groupId = String(membership.groupId)
          socket.join(groupRoom(campId, groupId)) // shared: participants + coordinator
        }
        if (isOrganizerTier(membership.role)) canOrganizers = true
      }
    }

    if (canOrganizers) socket.join(orgRoom(campId))

    const byCamp = socket.data.byCamp ?? new Map()
    byCamp.set(campId, { groupId, canOrganizers })
    socket.data.byCamp = byCamp

    // Presence: tell each joined room who's online now.
    if (groupId) {
      io.to(groupRoom(campId, groupId)).emit('chat:presence', {
        channel: 'group',
        groupId,
        onlineUserIds: await onlineUserIds(io, groupRoom(campId, groupId)),
      })
    }
    if (canOrganizers) {
      io.to(orgRoom(campId)).emit('chat:presence', {
        channel: 'organizers',
        groupId: null,
        onlineUserIds: await onlineUserIds(io, orgRoom(campId)),
      })
    }
  })

  socket.on('chat:send', async (payload: unknown) => {
    const parsed = sendMessageSchema.safeParse(payload)
    if (!parsed.success) {
      socket.emit('chat:error', { code: 'invalid', message: 'Invalid message' })
      return
    }
    const { campId, channel, text } = parsed.data
    const entitlement = socket.data.byCamp?.get(campId)
    if (!entitlement) {
      socket.emit('chat:error', { code: 'not_connected', message: 'Not connected to this camp' })
      return
    }

    if (channel === 'organizers') {
      if (!entitlement.canOrganizers) {
        socket.emit('chat:error', { code: 'forbidden', message: 'Not an organizer here' })
        return
      }
      const message = await chatService.postMessage({
        campId: new Types.ObjectId(campId),
        channel: 'organizers',
        groupId: null,
        authorId: new Types.ObjectId(user.id),
        text,
      })
      io.to(orgRoom(campId)).emit('chat:message', { channel: 'organizers', groupId: null, message })
      return
    }

    // channel === 'group' — groupId is SERVER-derived; a client-sent one is ignored.
    if (!entitlement.groupId) {
      socket.emit('chat:error', { code: 'no_group', message: 'You are not in a group' })
      return
    }
    const groupId = entitlement.groupId
    const message = await chatService.postMessage({
      campId: new Types.ObjectId(campId),
      channel: 'group',
      groupId: new Types.ObjectId(groupId),
      authorId: new Types.ObjectId(user.id),
      text,
    })
    io.to(groupRoom(campId, groupId)).emit('chat:message', { channel: 'group', groupId, message })
  })

  // On disconnect, socket.io auto-leaves rooms; re-emit presence for each room the
  // socket was in so remaining members see the drop.
  socket.on('disconnect', async () => {
    const byCamp = socket.data.byCamp
    if (!byCamp) return
    for (const [campId, e] of byCamp) {
      if (e.groupId) {
        io.to(groupRoom(campId, e.groupId)).emit('chat:presence', {
          channel: 'group',
          groupId: e.groupId,
          onlineUserIds: await onlineUserIds(io, groupRoom(campId, e.groupId)),
        })
      }
      if (e.canOrganizers) {
        io.to(orgRoom(campId)).emit('chat:presence', {
          channel: 'organizers',
          groupId: null,
          onlineUserIds: await onlineUserIds(io, orgRoom(campId)),
        })
      }
    }
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Manual — two-socket live send (deferred to F5)**

The full round-trip is verified end-to-end in the frontend (F5/F6) and in the whole-feature verification. For now: boot, connect a logged-in socket in the browser console, emit `s.emit('chat:connectCamp', { campId: '<realCampId>' })`, then `s.emit('chat:send', { campId: '<realCampId>', channel: 'group', text: 'hello' })`, and confirm a `chat:message` echo:

```js
s.on('chat:message', (m) => console.log('message', m))
s.on('chat:error', (e) => console.log('error', e))
```

Expected: a `chat:message` with `{ channel: 'group', groupId, message: { text: 'hello', ... } }`. A participant emitting `channel: 'organizers'` gets `chat:error { code: 'forbidden' }`.

- [ ] **Step 4: Commit**

```bash
git add src/sockets/chat.handlers.ts
git commit -m "feat(chat): socket handlers — room derivation, send, presence"
```

---

### Task B8: Coordinator group assignment — invite `groupId` + reassign route

**Files:**
- Modify: `src/validators/team.validators.ts`
- Modify: `src/services/team.services.ts`
- Modify: `src/controllers/team.controllers.ts`
- Modify: `src/routes/team.routes.ts`
- Modify: `src/models/membership.model.ts` (doc comment only)

**Interfaces:**
- Consumes: `GroupModel`, existing `callerCampIds`/`camp` resolution in `team.services`.
- Produces:
  - `inviteTeamSchema` gains optional `groupId` (24-hex or absent).
  - `setCoordinatorGroupSchema` = `{ groupId: string | null }`; `membershipIdParam`.
  - `teamService.invite(user, phone, role, groupId?)` — validates `groupId` only when `role === 'coordinator'`, resolves it against the caller's own target camp (rejects a foreign camp's group), stores it on the membership.
  - `teamService.setCoordinatorGroup(membershipId, groupId | null)` — 400 unless the target membership's `role === 'coordinator'`; resolves the group against that membership's own camp; stores/clears it.
- Route: `PATCH /organizer/team/:membershipId/group` (`requireRole('manager')`).

- [ ] **Step 1: Extend the validators**

```ts
import { z } from '../config/zod'
import { ORGANIZER_SUB_ROLES } from '../models/membership.model'

const ROLE = z.enum(ORGANIZER_SUB_ROLES)
const OBJECT_ID = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')

// groupId is OPTIONAL and only meaningful for a coordinator invite; the service
// rejects it for any other role and resolves it against the caller's own camp.
export const inviteTeamSchema = z.object({
  phone: z.string().min(5),
  role: ROLE,
  groupId: OBJECT_ID.optional(),
})

export const teamInviteIdParam = z.object({ id: OBJECT_ID })

// Reassign / clear a coordinator's group after the fact.
export const membershipIdParam = z.object({ membershipId: OBJECT_ID })
export const setCoordinatorGroupSchema = z.object({ groupId: OBJECT_ID.nullable() })
```

- [ ] **Step 2: Extend `teamService.invite` + add `setCoordinatorGroup`**

In `src/services/team.services.ts`, add the `GroupModel` import:

```ts
import { GroupModel } from '../models/group.model'
```

Add a private helper and thread `groupId` through `invite`. Replace the `invite` signature + membership create, and append `setCoordinatorGroup`:

```ts
  // Resolve a groupId against a specific camp: it must exist AND belong to that camp,
  // or a coordinator could be pointed at another camp's group. Returns the ObjectId.
  // (module-scoped helper — place above the teamService object)
```

```ts
async function resolveCampGroup(campId: Types.ObjectId, groupId: string): Promise<Types.ObjectId> {
  const group = await GroupModel.findOne({ _id: groupId, campId })
  if (!group) throw new HttpError(400, 'Group not found in this camp')
  return group._id
}
```

Update `invite` (add the `groupId` parameter and the coordinator guard + resolution; keep everything else identical):

```ts
  invite: async (
    user: HydratedDocument<User>,
    phone: string,
    role: string,
    groupId?: string,
  ) => {
    const campIds = await callerCampIds(user._id)
    if (campIds.length === 0) throw new HttpError(409, 'Create a camp before inviting teammates')
    const camp = await CampModel.findOne({ _id: { $in: campIds } }).sort({ createdAt: -1 })
    if (!camp) throw new HttpError(409, 'Create a camp before inviting teammates')

    // A group may only be attached to a coordinator, and only within THIS camp.
    let resolvedGroupId: Types.ObjectId | null = null
    if (groupId) {
      if (role !== 'coordinator') {
        throw new HttpError(400, 'Only a coordinator can be assigned a group')
      }
      resolvedGroupId = await resolveCampGroup(camp._id, groupId)
    }

    const existing = await MembershipModel.findOne({ campId: camp._id, phone })
    if (existing) throw new HttpError(409, 'This phone is already on the team')

    const invitee = await UserModel.findOne({ phone }).select('role')
    if (invitee?.role === 'manager') {
      throw new HttpError(409, 'Managers run their own camp and cannot join another camp’s team')
    }

    const m = await MembershipModel.create({
      campId: camp._id,
      phone,
      role: role as Membership['role'],
      status: 'pending',
      userId: null,
      groupId: resolvedGroupId,
    })
    return { id: String(m._id), phone: m.phone, role: m.role, sentAt: createdAtOf(m) }
  },

  // Reassign or clear a coordinator's group (handoff / group dissolved). Manager-gated
  // at the route. 400 if the target isn't a coordinator row.
  setCoordinatorGroup: async (membershipId: string, groupId: string | null) => {
    const m = await MembershipModel.findById(membershipId)
    if (!m) throw new HttpError(404, 'Membership not found')
    if (m.role !== 'coordinator') {
      throw new HttpError(400, 'Only a coordinator has a chat group')
    }
    m.groupId = groupId ? await resolveCampGroup(m.campId as Types.ObjectId, groupId) : null
    await m.save()
    return { id: String(m._id), groupId: m.groupId ? String(m.groupId) : null, role: m.role }
  },
```

- [ ] **Step 3: Update the controller + add the route handler**

In `src/controllers/team.controllers.ts`:

```ts
export const inviteTeammate: RequestHandler = async (req, res) => {
  res
    .status(201)
    .json(await teamService.invite(req.auth!.user, req.body.phone, req.body.role, req.body.groupId))
}

export const setTeamMemberGroup: RequestHandler = async (req, res) => {
  res.json(await teamService.setCoordinatorGroup(String(req.params.membershipId), req.body.groupId))
}
```

- [ ] **Step 4: Add the route**

In `src/routes/team.routes.ts`, import the new validators and add the PATCH (manager-gated, mirroring the invite guards):

```ts
import {
  inviteTeamSchema,
  teamInviteIdParam,
  membershipIdParam,
  setCoordinatorGroupSchema,
} from '../validators/team.validators'
```

```ts
router.patch(
  '/:membershipId/group',
  requireRole('manager'),
  validate({ params: membershipIdParam, body: setCoordinatorGroupSchema }),
  c.setTeamMemberGroup,
)
```

- [ ] **Step 5: Update the Membership `groupId` doc comment**

In `src/models/membership.model.ts`, replace the `groupId` line's comment to state the dual meaning:

```ts
    // For a participant row: the group they belong to. For a coordinator row: the
    // single group they chat with (structural, not a rule). null = unassigned in both.
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 7: Manual — invite a coordinator with a group**

With a manager cookie against a seeded camp that has groups:

```bash
# Get a real groupId first:
curl -s http://localhost:4000/api/organizer/camps/<campId>/groups -b "camply_sid=<...>"
# Invite a coordinator pointed at one:
curl -s -X POST http://localhost:4000/api/organizer/team/invites \
  -b "camply_sid=<managerSid>" -H 'Content-Type: application/json' \
  -d '{"phone":"+998900000001","role":"coordinator","groupId":"<groupId>"}'
# Expected: 201 with the pending row. A non-coordinator role + groupId → 400.
# A foreign camp's groupId → 400 "Group not found in this camp".
```

- [ ] **Step 8: Commit**

```bash
git add src/validators/team.validators.ts src/services/team.services.ts \
  src/controllers/team.controllers.ts src/routes/team.routes.ts src/models/membership.model.ts
git commit -m "feat(chat): coordinator group assignment (invite groupId + reassign route)"
```

---

### Task B9: `my-role` endpoint — server-known coordinator gating

**Files:**
- Modify: `src/services/camp.services.ts` (add `myRole` projection)
- Modify: `src/controllers/camp.controllers.ts` (add handler)
- Modify: `src/routes/camp.routes.ts` (add route on `campRouter`)

**Interfaces:**
- Consumes: `req.camp`, `req.membership` (from `requireCampMember`).
- Produces: `GET /camps/:id/my-role` (member-level) → `{ role: string, groupId: string | null }` for the caller's own membership. Org super-admin → `{ role: 'organization', groupId: null }`.

- [ ] **Step 1: Add the projection to `camp.services.ts`**

Append to the `campService` object (near `summary`):

```ts
  // The caller's OWN role + group in this camp — the server-known fact that replaces
  // the frontend's unpersisted useOrganizerStore.role for coordinator gating.
  myRole: (membership: HydratedDocument<Membership> | null, isOrg: boolean) => {
    if (isOrg) return { role: 'organization' as const, groupId: null }
    if (!membership) return { role: null, groupId: null }
    return {
      role: membership.role,
      groupId: membership.groupId ? String(membership.groupId) : null,
    }
  },
```

Ensure `Membership` and `HydratedDocument` are imported in `camp.services.ts` (they are already used there — confirm; if not, add `import type { HydratedDocument } from 'mongoose'` and `import type { Membership } from '../models/membership.model'`).

- [ ] **Step 2: Add the controller**

In `src/controllers/camp.controllers.ts`:

```ts
export const getMyRole: RequestHandler = (req, res) => {
  const isOrg = req.auth!.user.role === 'organization'
  res.json(campService.myRole(req.membership ?? null, isOrg))
}
```

- [ ] **Step 3: Add the route**

In `src/routes/camp.routes.ts`, on `campRouter`, next to `/:id/my-group`:

```ts
campRouter.get(
  '/:id/my-role',
  requireAuth,
  validate({ params: campIdParam }),
  requireCampMember,
  getMyRole,
)
```

Add `getMyRole` to the `camp.controllers` import at the top of the file (it already imports `* as c` — use `c.getMyRole` instead if that's the existing style; match the file. `getMyGroup` is imported by name from `group.controllers`, so `c.getMyRole` is correct for camp controllers).

Use `c.getMyRole`:

```ts
campRouter.get('/:id/my-role', requireAuth, validate({ params: campIdParam }), requireCampMember, c.getMyRole)
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 5: Manual — curl**

```bash
curl -s http://localhost:4000/api/camps/<campId>/my-role -b "camply_sid=<participantSid>"
# Expected: {"role":"participant","groupId":"<...>"}
# A coordinator: {"role":"coordinator","groupId":"<their group>"}
```

- [ ] **Step 6: Commit**

```bash
git add src/services/camp.services.ts src/controllers/camp.controllers.ts src/routes/camp.routes.ts
git commit -m "feat(chat): GET /camps/:id/my-role for server-known coordinator gating"
```

---

### Task B10: OpenAPI docs for the new REST routes

**Files:**
- Modify: `src/docs/openapi.ts`

**Interfaces:**
- Produces: `registry.registerPath(...)` entries for `GET /api/camps/{id}/chat/group/messages`, `GET /api/camps/{id}/chat/organizers/messages`, `GET /api/camps/{id}/my-role`, `PATCH /api/organizer/team/{membershipId}/group`. Socket events are documented in the spec, not OpenAPI.

- [ ] **Step 1: Register the four paths**

Add near the other camp-scoped `registerPath` calls (mirror the existing shape shown in `docs/openapi.ts`). Reuse `campIdParam` (already imported) and `membershipIdParam`/`setCoordinatorGroupSchema` (import them from `team.validators`).

```ts
import { setCoordinatorGroupSchema, membershipIdParam } from '../validators/team.validators'
```

```ts
registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}/chat/group/messages',
  tags: ['Chat'],
  summary: "The caller's group chat — latest 50 messages + room members",
  request: { params: campIdParam },
  responses: {
    200: { description: 'Group history (empty if unassigned)' },
    401: { description: 'Not authenticated' },
    403: { description: 'Not a member of this camp' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}/chat/organizers/messages',
  tags: ['Chat'],
  summary: 'The organizers channel — latest 50 messages + organizer-tier members',
  request: { params: campIdParam },
  responses: {
    200: { description: 'Organizers history' },
    401: { description: 'Not authenticated' },
    403: { description: 'Organizer-tier only' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}/my-role',
  tags: ['Chat'],
  summary: "The caller's own role + group in this camp (coordinator gating)",
  request: { params: campIdParam },
  responses: {
    200: { description: '{ role, groupId }' },
    401: { description: 'Not authenticated' },
    403: { description: 'Not a member of this camp' },
  },
})

registry.registerPath({
  method: 'patch',
  path: '/api/organizer/team/{membershipId}/group',
  tags: ['Team'],
  summary: "Reassign or clear a coordinator's chat group (manager only)",
  request: {
    params: membershipIdParam,
    body: { content: { 'application/json': { schema: setCoordinatorGroupSchema } } },
  },
  responses: {
    200: { description: 'Updated' },
    400: { description: 'Target is not a coordinator / group not in camp' },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    404: { description: 'Membership not found' },
  },
})
```

- [ ] **Step 2: Typecheck + docs load**

Run: `npm run typecheck`
Expected: passes. Boot and open `http://localhost:4000/api/docs` — the Chat + Team entries render.

- [ ] **Step 3: Commit**

```bash
git add src/docs/openapi.ts
git commit -m "docs(chat): register chat, my-role, coordinator-group paths in OpenAPI"
```

---

### Task B11: Backend validate + close-out

- [ ] **Step 1: Full validate**

Run: `npm run validate`
Expected: lint + format:check + typecheck all pass. If format flags files you touched, run `npx prettier --write --end-of-line auto <files>` on **only** those files (Windows CRLF caveat).

- [ ] **Step 2: Update `backend/CLAUDE.md`**

Add a short "Realtime chat" subsection under the CRUD domains: the `Message` model, the two history routes on `campRouter`, the `sockets/` layer (cookie-auth handshake, server-derived rooms, `chat:*` events), the coordinator-group write paths, and `GET /camps/:id/my-role`. Point to this plan + the spec.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-22-realtime-chat.md CLAUDE.md
git commit -m "docs(chat): plan + backend CLAUDE.md realtime-chat section"
```

---

# PART 2 — FRONTEND (`camply-frontend`)

**File structure (frontend):**
- Create: `src/api/services/chat.service.ts` — group + organizers history services (migrated from `lib/chat.ts`).
- Create: `src/api/queries/chat.queries.ts` — `useChat(campId, groupId)`, `useOrgChat(campId)`, `useMyRole(campId)`.
- Modify: `src/api/queryKeys.ts` — add `campKeys.chatOrganizers(campId)` and `campKeys.myRole(campId)`; keep `campKeys.chat`.
- Modify: `src/api/services/orgChat.service.ts` — delete mock branch; real organizers-history call.
- Modify: `src/api/realtime/realtimeBridge.ts` — real Socket.IO client; `chat:message` → cache append (group + organizers); presence.
- Modify: `src/components/participant/ParticipantDashboard.tsx` — connect realtime on camp resolve.
- Modify: `src/components/participant/chat/ChatScreen.tsx` — `useChat(campId, groupId)` (via camp context + my-group).
- Modify: `src/components/participant/chat/MessageList.tsx` — read the socket-fed cache, not the local `sent[]`.
- Modify: `src/components/organizer/chat/OrgChatScreen.tsx` — resolve active camp; `useMyRole` gating; real `useOrgChat(campId)` + `useChat(campId, groupId)` for the group tab; connect realtime.
- Modify: `src/store/useChatStore.ts` + `src/store/useOrgChatStore.ts` — send via socket (optimistic append); drop `sendAttachment` from the send path.
- Modify: `src/components/participant/chat/Composer.tsx` — hide the attachment `+` button.
- Modify: `vite.config.ts` — Socket.IO proxy with `ws: true`.
- Modify: `src/lib/chat.ts` — reduced to the shared **types** re-export (or types move into the service). Keep `withMyProfile`/`MeIdentity` where the screens import them.

> **Naming:** the spec named the organizers key `organizerKeys.orgChatOrganizers(campId)`. Because the organizers channel is **camp-scoped** (it's per the organizer's camp), this plan places it under `campKeys.chatOrganizers(campId)` instead — consistent with `campKeys.chat` and the "camp data is nested under campKeys" rule. The group tab reuses `campKeys.chat(campId, groupId)` exactly as the spec requires.

---

### Task F1: Add `socket.io-client` + Vite WS proxy

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

**Interfaces:**
- Produces: `socket.io-client` available; `/socket.io` path proxied to `:4000` with `ws: true`.

- [ ] **Step 1: Install**

```bash
cd /Users/mn.afridi/Desktop/Camply/Frontend
npm install socket.io-client
```

- [ ] **Step 2: Proxy the Socket.IO path with WebSocket upgrade**

Socket.IO defaults to the `/socket.io` path. The current proxy only forwards `/api` (HTTP). Add a WS-enabled entry — **`ws: true` is mandatory** or the handshake upgrade silently fails only in the browser. Replace the `server.proxy` block in `vite.config.ts`:

```ts
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to the Express backend during development
      '/api': 'http://localhost:4000',
      // Socket.IO handshake UPGRADES the connection — ws:true is required or it
      // connects over HTTP polling only in dev and never upgrades in the browser.
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "chore(chat): add socket.io-client and Vite WS proxy"
```

---

### Task F2: Query keys — organizers-channel + my-role keys

**Files:**
- Modify: `src/api/queryKeys.ts`

**Interfaces:**
- Produces: `campKeys.chatOrganizers(campId)` = `[...all(campId), 'chatOrganizers']`; `campKeys.myRole(campId)` = `[...all(campId), 'myRole']`. `campKeys.chat(campId, groupId)` stays as-is.

- [ ] **Step 1: Add the keys**

In the `campKeys` object, after the `chat` line:

```ts
  /** The organizers channel (camp-wide, organizer-tier). Separate from the group chat. */
  chatOrganizers: (campId: string) => [...campKeys.all(campId), 'chatOrganizers'] as const,
  /** The caller's own role + group in this camp (coordinator gating). */
  myRole: (campId: string) => [...campKeys.all(campId), 'myRole'] as const,
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/api/queryKeys.ts
git commit -m "feat(chat): add chatOrganizers + myRole query keys"
```

---

### Task F3: Chat service + queries (migrate `lib/chat.ts` → `api/`)

**Files:**
- Create: `src/api/services/chat.service.ts`
- Create: `src/api/queries/chat.queries.ts`
- Modify: `src/lib/chat.ts` (keep types + `withMyProfile`; remove the mock `useChat`/`fetchGroupChat`)

**Interfaces:**
- Consumes: `axiosInstance`, `campKeys`, the `ChatMember`/`ChatMessage` types (kept in `lib/chat.ts`).
- Produces:
  - `chatService.groupHistory(campId): Promise<GroupHistory>` → `{ groupId, members, messages }`.
  - `chatService.organizersHistory(campId): Promise<OrgHistory>` → `{ members, messages }`.
  - `chatService.myRole(campId): Promise<{ role: string | null; groupId: string | null }>`.
  - `useChat(campId, groupId)` keyed by `campKeys.chat(campId, groupId)`, `enabled: !!campId && !!groupId`.
  - `useOrgChat(campId)` keyed by `campKeys.chatOrganizers(campId)`.
  - `useMyRole(campId)` keyed by `campKeys.myRole(campId)`.

- [ ] **Step 1: Create the service**

```ts
import { axiosInstance } from '../axiosInstance'
import type { ChatMember, ChatMessage } from '@/lib/chat'

export type GroupHistory = {
  groupId: string | null
  members: ChatMember[]
  messages: ChatMessage[]
}
export type OrgHistory = {
  members: ChatMember[]
  messages: ChatMessage[]
}
export type MyRole = { role: string | null; groupId: string | null }

export const chatService = {
  groupHistory: async (campId: string): Promise<GroupHistory> =>
    (await axiosInstance.get<GroupHistory>(`/camps/${campId}/chat/group/messages`)).data,
  organizersHistory: async (campId: string): Promise<OrgHistory> =>
    (await axiosInstance.get<OrgHistory>(`/camps/${campId}/chat/organizers/messages`)).data,
  myRole: async (campId: string): Promise<MyRole> =>
    (await axiosInstance.get<MyRole>(`/camps/${campId}/my-role`)).data,
}
```

- [ ] **Step 2: Create the queries**

```ts
import { useQuery } from '@tanstack/react-query'
import { chatService } from '../services/chat.service'
import { campKeys } from '../queryKeys'

// The group chat: participants AND the group's coordinator share this exact cache
// entry (same room server-side). Realtime chat:message appends here via setQueryData.
export function useChat(campId: string, groupId: string) {
  return useQuery({
    queryKey: campKeys.chat(campId, groupId),
    queryFn: () => chatService.groupHistory(campId),
    enabled: Boolean(campId) && Boolean(groupId),
  })
}

// The organizers channel — camp-wide, organizer-tier only.
export function useOrgChat(campId: string) {
  return useQuery({
    queryKey: campKeys.chatOrganizers(campId),
    queryFn: () => chatService.organizersHistory(campId),
    enabled: Boolean(campId),
  })
}

// The caller's own role + group in this camp (server-known coordinator gating).
export function useMyRole(campId: string) {
  return useQuery({
    queryKey: campKeys.myRole(campId),
    queryFn: () => chatService.myRole(campId),
    enabled: Boolean(campId),
  })
}
```

- [ ] **Step 3: Reduce `lib/chat.ts` to types + `withMyProfile`**

The backend now serves the group chat, so the mock seam goes. Keep the **types** (`ChatMember`, `ChatMessage`, `MessageStatus`, `MessageReaction`, `ChatMessageKind`, `GroupChat`, `MeIdentity`) and `withMyProfile` — screens still import them. **Delete** `fetchGroupChat`, the mock import, and `useChat` (moved to `chat.queries.ts`). Update the `useChat` import sites (F4/F7) to the new query.

Remove these from `lib/chat.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { groupChatMock } from '@/lib/mocks/mockChat'
// ...
export async function fetchGroupChat(): Promise<GroupChat> { ... }
export function useChat() { ... }
```

> Leave `mockChat.ts`/`mockOrgChat.ts` in place for now (other refs may exist); a later cleanup removes them once nothing imports them. Confirm with `grep -rn "groupChatMock\|orgChatMock\|mockChat\|mockOrgChat" src` after F4/F7 and delete the mocks if unreferenced.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: FAILS — `ChatScreen`/`OrgChatScreen` still import the old `useChat` from `lib/chat`. That's expected; F4 and F7 fix the call sites. (If you want a green checkpoint, do F4 before committing F3. Otherwise commit F3+F4 together.)

- [ ] **Step 5: Commit (with F4)**

Defer the commit to the end of F4 so the tree typechecks.

---

### Task F4: Participant `ChatScreen` → real `useChat(campId, groupId)` + socket-fed list

**Files:**
- Modify: `src/components/participant/chat/ChatScreen.tsx`
- Modify: `src/components/participant/chat/MessageList.tsx`

**Interfaces:**
- Consumes: `useCamp()` (campId from context), `useMyGroup(campId)` (existing — gives the caller's groupId), `useChat(campId, groupId)`, `campKeys.chat`.
- Produces: the participant thread renders server history from the cache; new sends and incoming `chat:message` both land in the same cache entry (F5 + F8).

- [ ] **Step 1: Resolve campId + groupId and call the real hook**

`ChatScreen` currently calls `useChat()` with no args. Wire it to the camp context + the caller's group. The participant's groupId comes from the existing `useMyGroup(campId)` query (`myGroup.queries.ts`). Update the top of `ChatScreen`:

```tsx
import { useCamp } from '../campContext'
import { useMyGroup } from '../../../api/queries/myGroup.queries'
import { useChat } from '../../../api/queries/chat.queries'
import { withMyProfile, type ChatMember, type ChatMessage } from '../../../lib/chat'
```

```tsx
  const { campId } = useCamp()
  const { data: myGroup } = useMyGroup(campId)
  const groupId = myGroup?.group?.id ?? ''
  const { data, isLoading, isError } = useChat(campId, groupId)
```

> Confirm the `useMyGroup` return shape (`myGroup.service.ts`): if the group id lives at `myGroup.group.id`, use that; adjust the path to match the actual field. If unassigned (`group: null`), `groupId` is `''` and `useChat` stays disabled — render the existing empty/loading branch (a participant with no group has no chat).

The rest of `ChatScreen` (members overlay, reply helpers, render) stays. `data` is now `GroupHistory` (`{ groupId, members, messages }`) — it already has `members` and `messages`, so `data.members`/`data.messages` keep working. `data.group` no longer exists; the header needs group identity from `useMyGroup` instead:

```tsx
      <ChatHeader
        group={{
          name: myGroup?.group?.name ?? '',
          emoji: myGroup?.group?.emoji ?? '💬',
          memberCount: data.members.length,
          onlineCount: 0, // presence fills this in (F5); 0 until then
        }}
        members={members}
        ...
      />
```

> Match `ChatHeader`'s prop type — if it requires the full `GroupChat['group']`, adapt the object to those fields. Keep it minimal; the emoji/name come from the group projection.

- [ ] **Step 2: `MessageList` reads the socket-fed cache, not local `sent[]`**

Today `MessageList` concatenates `serverMessages` with `useChatStore.sent`. After F5/F8, the socket echo lands in the **query cache** (`serverMessages` already reflects it), so the local `sent[]` becomes only the *optimistic* in-flight messages. Simplify `MessageList` to render `serverMessages` plus the store's still-pending optimistic messages (F8 defines `pending`). For this task, keep the existing `sent` concat working (it's harmless) and only change the import of `useChat` sites. The store change is F8.

Leave `MessageList` as-is in F4; F8 revisits it once the store sends over the socket.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes (F3 + F4 together resolve the `useChat` migration). Fix any prop-shape mismatches surfaced by `tsc`.

- [ ] **Step 4: Commit (F3 + F4)**

```bash
git add src/api/services/chat.service.ts src/api/queries/chat.queries.ts src/lib/chat.ts \
  src/components/participant/chat/ChatScreen.tsx
git commit -m "feat(chat): participant chat reads live group history via useChat(campId, groupId)"
```

---

### Task F5: Realtime bridge → real Socket.IO client

**Files:**
- Modify: `src/api/realtime/realtimeBridge.ts`

**Interfaces:**
- Consumes: `io` from `socket.io-client`, `queryClient`, `campKeys`.
- Produces:
  - `connectRealtime(campId)` — opens the single socket (if not open), emits `chat:connectCamp { campId }` on connect.
  - `disconnectRealtime()` — closes it.
  - `getSocket()` — returns the live socket (used by the stores to `emit('chat:send')`).
  - Incoming `chat:message` → append into `campKeys.chat(campId, groupId)` (group) or `campKeys.chatOrganizers(campId)` (organizers). `chat:presence` → (optional) a light setQueryData/no-op for now.

- [ ] **Step 1: Rewrite the bridge with socket.io-client**

```ts
import { io, type Socket } from 'socket.io-client'
import { queryClient } from '@/api/queryClient'
import { campKeys } from '../queryKeys'
import type { ChatMessage } from '@/lib/chat'

/*
  The realtime BRIDGE — the ONE socket, routing server events into the SAME React
  Query cache the UI reads (append for chat). No parallel state store. Auth rides the
  httpOnly camply_sid cookie on the handshake (same-origin via the Vite /socket.io
  proxy), so no token in JS.
*/

type ChatMessageEvent = {
  channel: 'group' | 'organizers'
  groupId: string | null
  message: ChatMessage
}

// Same-origin by default (Vite proxies /socket.io in dev). Override with VITE_WS_URL.
const WS_URL = import.meta.env.VITE_WS_URL ?? undefined

let socket: Socket | null = null
let currentCampId: string | null = null

export function connectRealtime(campId: string) {
  if (socket && currentCampId === campId) return
  if (socket) disconnectRealtime()
  currentCampId = campId

  socket = io(WS_URL ?? '', { withCredentials: true })

  socket.on('connect', () => {
    socket?.emit('chat:connectCamp', { campId })
  })

  socket.on('chat:message', (evt: ChatMessageEvent) => {
    if (!currentCampId) return
    const key =
      evt.channel === 'group' && evt.groupId
        ? campKeys.chat(currentCampId, evt.groupId)
        : campKeys.chatOrganizers(currentCampId)

    queryClient.setQueryData(key, (prev: unknown) => {
      const data = (prev ?? {}) as { messages?: ChatMessage[]; [k: string]: unknown }
      const messages = Array.isArray(data.messages) ? data.messages : []
      // Dedupe: the optimistic append + the echo can both arrive.
      if (messages.some((m) => m.id === evt.message.id)) return data
      return { ...data, messages: [...messages, evt.message] }
    })
  })

  // Presence is best-effort UI sugar; wire a store/onlineCount later if desired.
  // socket.on('chat:presence', (p) => { ... })
}

export function disconnectRealtime() {
  socket?.disconnect()
  socket = null
  currentCampId = null
}

export function getSocket(): Socket | null {
  return socket
}
```

> The cache shape changed from the stub's bare array to `{ messages: [...] }` because the history endpoints return an object (`GroupHistory`/`OrgHistory`). The append writes into `data.messages`, matching what `useChat`/`useOrgChat` read.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/api/realtime/realtimeBridge.ts
git commit -m "feat(chat): real Socket.IO client bridge with chat:message cache append"
```

---

### Task F6: Connect realtime from the participant shell

**Files:**
- Modify: `src/components/participant/ParticipantDashboard.tsx`

**Interfaces:**
- Consumes: `connectRealtime`/`disconnectRealtime` (F5), the resolved `camp.id`.
- Produces: the socket opens once the participant's camp resolves; closes on unmount.

- [ ] **Step 1: Connect on camp resolve**

Add the effect after `camp` is resolved (non-null). Import at the top:

```tsx
import { useEffect } from 'react'
import { connectRealtime, disconnectRealtime } from '../../api/realtime/realtimeBridge'
```

Add the effect (place it before the `if (isPending || !camp)` gate is fine — guard on `camp?.id`):

```tsx
  useEffect(() => {
    if (!camp?.id) return
    connectRealtime(camp.id)
    return () => disconnectRealtime()
  }, [camp?.id])
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Manual — live participant↔participant**

Boot both (`npm run dev` in each repo, `npm run seed:demo` in backend first). Log in as two participants of the **same group** in two browsers. Open Chat in both. Send from one → it appears live in the other **without a refresh**. Reload → history persists (last 50).

- [ ] **Step 4: Commit**

```bash
git add src/components/participant/ParticipantDashboard.tsx
git commit -m "feat(chat): connect realtime when the participant camp resolves"
```

---

### Task F7: Organizer `OrgChatScreen` → active camp + server-known gating + real data

**Files:**
- Modify: `src/components/organizer/chat/OrgChatScreen.tsx`
- Modify: `src/api/services/orgChat.service.ts` (or delete in favour of `chat.service`)

**Interfaces:**
- Consumes: `useOrganizerCamps()` (active camp = `camps[0]`), `useMyRole(campId)`, `useOrgChat(campId)` (organizers channel), `useChat(campId, groupId)` (group tab — same hook as participants), `connectRealtime`.
- Produces: the organizers tab shows live organizer-channel history; the group tab is gated on server `role === 'coordinator'` and shows the identical thread participants see; realtime connected for the organizer's camp.

- [ ] **Step 1: Resolve the organizer's active camp + role**

Replace the mock `useOrgChat()` + `useOrganizerStore.role` reads:

```tsx
import { useOrganizerCamps } from '../../../api/queries/camps.queries'
import { useMyRole, useOrgChat, useChat } from '../../../api/queries/chat.queries'
import { connectRealtime, disconnectRealtime } from '../../../api/realtime/realtimeBridge'
import { useEffect } from 'react'
```

```tsx
  const { data: camps } = useOrganizerCamps()
  const campId = camps?.[0]?.id ?? '' // one camp per organizer/manager for now
  const { data: myRole } = useMyRole(campId)
  const isCoordinator = myRole?.role === 'coordinator'
  const coordinatorGroupId = myRole?.groupId ?? ''

  const { data: orgData, isPending: orgPending } = useOrgChat(campId)
  const { data: groupData } = useChat(campId, coordinatorGroupId)

  useEffect(() => {
    if (!campId) return
    connectRealtime(campId)
    return () => disconnectRealtime()
  }, [campId])
```

Delete the `role = useOrganizerStore((s) => s.role)` line and its import if now unused.

- [ ] **Step 2: Feed the two channels from the two hooks**

Replace `const active = channel === 'organizers' ? data.organizers : data.group`. The two channels now come from separate hooks:

```tsx
  const active =
    channel === 'organizers'
      ? { members: orgData?.members ?? [], messages: orgData?.messages ?? [], onlineCount: 0, emoji: '📋', title: t.org.chat.channelOrganizers }
      : { members: groupData?.members ?? [], messages: groupData?.messages ?? [], onlineCount: 0, emoji: '💬', title: t.org.chat.channelGroup }

  const locked = channel === 'group' && !isCoordinator
```

Adjust the loading/error guards to gate on `orgPending` for the organizers tab. Keep the members overlay (`withMyProfile(active.members, me)`), the online rail, the members sheet, and the composer wiring — they read from `active.members`/`active.messages` which now come from the real hooks.

> The group tab intentionally uses **the same `useChat(campId, groupId)`** as the participant screen — same cache entry, same room. When a participant posts, the coordinator's group tab updates live (and vice-versa) because both subscribe to `campKeys.chat(campId, groupId)`.

- [ ] **Step 3: Retire the mock `orgChat.service`**

`useOrgChat` now lives in `chat.queries.ts`. Delete the old `src/api/queries/orgChat.queries.ts` `useOrgChat` and `src/api/services/orgChat.service.ts`'s mock `get()` — or delete both files if nothing else imports them. `OrgChatChannelId` (used by `useOrgChatStore`) must survive: move `export type OrgChatChannelId = 'organizers' | 'group'` into `useOrgChatStore.ts` (or a small shared types file) and update imports. Run `grep -rn "orgChat.service\|orgChat.queries" src` and fix every import.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes. Resolve any dangling imports from the deleted mock files.

- [ ] **Step 5: Commit**

```bash
git add src/components/organizer/chat/ src/api/services/orgChat.service.ts \
  src/api/queries/orgChat.queries.ts src/store/useOrgChatStore.ts
git commit -m "feat(chat): organizer chat on real data — active camp, server-known coordinator gating"
```

---

### Task F8: Sending over the socket (optimistic append) + hide attachments

**Files:**
- Modify: `src/store/useChatStore.ts`
- Modify: `src/store/useOrgChatStore.ts`
- Modify: `src/components/participant/chat/MessageList.tsx`
- Modify: `src/components/participant/chat/ChatScreen.tsx` + `src/components/organizer/chat/OrgChatScreen.tsx` (send call sites)
- Modify: `src/components/participant/chat/Composer.tsx` (hide `+`)

**Interfaces:**
- Consumes: `getSocket()` (F5).
- Produces: `sendText` emits `chat:send` over the socket and optimistically appends into the **query cache** (so it renders immediately and reconciles with the echo by id). `sendAttachment` is removed from the send path; the composer's `+` is hidden.

- [ ] **Step 1: Rework `useChatStore.sendText` to emit over the socket**

The store no longer owns a permanent `sent[]`. It emits `chat:send` and writes an **optimistic** message into the query cache; the socket echo (F5, dedup by id) replaces it. Simplest correct approach: the store's `sendText` takes the `campId`, `channel`, and cache key, and does the optimistic write itself.

Rewrite `useChatStore` to a thin sender (drop the fake read-receipt timer and `sendAttachment`):

```ts
import { create } from 'zustand'
import { getSocket } from '@/api/realtime/realtimeBridge'
import { queryClient } from '@/api/queryClient'
import { campKeys } from '@/api/queryKeys'
import type { ChatMessage } from '@/lib/chat'

let seq = 0
const optimisticId = () => `local-${Date.now()}-${seq++}`
const nowHHMM = () => new Date().toTimeString().slice(0, 5)

type ChatState = {
  sendText: (campId: string, groupId: string, text: string) => void
}

export const useChatStore = create<ChatState>(() => ({
  sendText: (campId, groupId, text) => {
    const clean = text.trim()
    if (!clean) return
    const optimistic: ChatMessage = {
      id: optimisticId(),
      authorId: 'me', // resolved to the real author in the UI; the echo carries the real id
      kind: 'text',
      text: clean,
      time: nowHHMM(),
      sentByMe: true,
      status: 'sent',
    }
    // Show immediately.
    queryClient.setQueryData(campKeys.chat(campId, groupId), (prev: unknown) => {
      const data = (prev ?? { messages: [] }) as { messages?: ChatMessage[] }
      const messages = Array.isArray(data.messages) ? data.messages : []
      return { ...data, messages: [...messages, optimistic] }
    })
    // Send; the server echo (chat:message) reconciles by id (dedup in the bridge).
    getSocket()?.emit('chat:send', { campId, channel: 'group', text: clean })
  },
}))
```

> **Reconciliation note:** the optimistic message has a `local-…` id; the echo has the real DB id. The bridge dedups by id, so both currently coexist (the echo won't match the optimistic id). To avoid a duplicate, either (a) drop the optimistic append and rely on the echo (simplest — the round-trip is sub-100ms same-origin), or (b) tag the optimistic message and reconcile. **Recommended: option (a)** — remove the optimistic `setQueryData` block and just `emit`; the echo append (F5) renders it. This keeps one source of truth and matches the "realtime is a bridge into the cache" rule. Implement option (a) unless latency proves visible.

**Adopt option (a):** the store's `sendText` becomes just validation + emit:

```ts
  sendText: (campId, groupId, text) => {
    const clean = text.trim()
    if (!clean) return
    getSocket()?.emit('chat:send', { campId, channel: 'group', text: clean })
  },
```

(Drop the `queryClient`/`campKeys`/`ChatMessage`/`optimisticId`/`nowHHMM` imports if unused.)

- [ ] **Step 2: Rework `useOrgChatStore.sendText` the same way**

```ts
import { create } from 'zustand'
import { getSocket } from '@/api/realtime/realtimeBridge'

export type OrgChatChannelId = 'organizers' | 'group'

type OrgChatState = {
  sendText: (campId: string, channel: OrgChatChannelId, text: string) => void
}

export const useOrgChatStore = create<OrgChatState>(() => ({
  sendText: (campId, channel, text) => {
    const clean = text.trim()
    if (!clean) return
    getSocket()?.emit('chat:send', { campId, channel, text: clean })
  },
}))
```

> This drops the per-channel `sent[]`, `reactionOverrides`, `teamPhoto`, and `sendAttachment`. Reactions/photos are client-only cosmetic (spec: left alone) — **if** any surviving UI still reads `reactionOverrides`/`teamPhoto` from this store, keep those slices and only replace `sendText`/`sendAttachment`. Run `grep -rn "useOrgChatStore" src` first; preserve whatever the screens still consume, remove only the send path. Same check for `useChatStore` (`grep -rn "useChatStore" src`) — `MessageList` reads `sent`/`reactionOverrides`/`toggleReaction`; keep the reaction slice if the UI still shows reactions, drop `sent`/`sendAttachment`.

> **Decision to make during execution:** the mock stores carried reactions + read-receipts as cosmetic client state. The spec says leave those alone. The clean path is to keep a minimal reactions slice if the UI renders it, and strip only the message-sending/attachment machinery. Match what the components actually import — don't remove a slice something still reads.

- [ ] **Step 3: Update `MessageList` to render only the cache**

Since sends now go to the server and come back as `chat:message` (appended to the cache read by `useChat`), `serverMessages` already contains everything. Remove the `useChatStore.sent` concat:

```tsx
  const all = useMemo(() => serverMessages, [serverMessages])
```

Keep the `reactionOverrides`/`toggleReaction` reads **only if** the reactions UI stays. If you strip reactions from the store, remove those props too. Keep `authorId: 'me'` handling: the echo carries the real author id, so `sentByMe` must be derived — see Step 5.

- [ ] **Step 4: Update the send call sites**

`ChatScreen.handleSendText`:

```tsx
  const sendText = useChatStore((s) => s.sendText)
  // ...
  const handleSendText = (text: string) => {
    sendText(campId, groupId, text)
    setReplyingTo(null)
  }
```

`OrgChatScreen.handleSendText`:

```tsx
  const sendText = useOrgChatStore((s) => s.sendText)
  // ...
  const handleSendText = (text: string) => {
    sendText(campId, channel, text)
    setReplyingTo(null)
  }
```

- [ ] **Step 5: Derive `sentByMe` from the current user**

Server messages carry `authorId` (the real user id), not `sentByMe`. The bubble needs to know which are mine. In the screens, resolve the current user's id (from `useCurrentUser()` / `useMe`) and map messages to set `sentByMe`/mark the author. Simplest: in `ChatScreen`/`OrgChatScreen`, when building the list, compute `sentByMe = message.authorId === myUserId`. Add a small map step where `data.messages` is read, or pass `myId` into `MessageList`/`MessageThread` and compute there.

Add to `ChatScreen`:

```tsx
import { useCurrentUser } from '../../../api/queries/auth.queries'
// ...
  const { data: currentUser } = useCurrentUser()
  const myId = currentUser?.id ?? ''
```

Pass `myId` to `MessageList` and, in `MessageList`, derive per message:

```tsx
        const mine = m.authorId === myId
        // use `mine` for the bubble's alignment/ticks instead of m.sentByMe
```

> Adjust `MessageBubble` to accept a `mine` prop (or keep reading `message.sentByMe` and set it in a map: `serverMessages.map(m => ({ ...m, sentByMe: m.authorId === myId }))`). The map approach is least invasive — do that in the screen and pass the mapped array as `serverMessages`.

- [ ] **Step 6: Hide the attachment `+` button in `Composer`**

Attachments are hidden for v1 (no upload pipeline). Remove/hide the paperclip button and the `AttachmentMenu`/hidden file inputs so nothing is wired to a no-op. Simplest: gate the attachment UI behind a prop `allowAttachments = false` defaulted off, and stop passing `onPickFile`. Minimal change — delete the attachment `<button>` + `AttachmentMenu` + the three hidden `<input>`s and the `onPickFile` prop usage from `Composer`; drop `onPickFile` from `Props` (and its call sites).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: passes. Resolve every reference to the removed `sendAttachment`/`onPickFile`/`sent`.

- [ ] **Step 8: Commit**

```bash
git add src/store/useChatStore.ts src/store/useOrgChatStore.ts \
  src/components/participant/chat/ src/components/organizer/chat/OrgChatScreen.tsx
git commit -m "feat(chat): send over socket (echo-reconciled); hide attachments for v1"
```

---

### Task F9: Frontend validate + close-out

- [ ] **Step 1: Full validate**

Run: `npm run validate`
Expected: lint + format:check + typecheck pass. Format only touched files (`npx prettier --write --end-of-line auto <files>`), per the Windows CRLF caveat.

- [ ] **Step 2: Remove now-dead mocks**

```bash
grep -rn "groupChatMock\|orgChatMock\|mockChat\|mockOrgChat" src
```

If unreferenced, delete `src/lib/mocks/mockChat.ts` and `src/lib/mocks/mockOrgChat.ts`. Re-run `npm run validate`.

- [ ] **Step 3: Update `frontend/CLAUDE.md`**

Update the data-layer section: `lib/chat.ts` is now types + `withMyProfile` only (its mock seam migrated to `api/services/chat.service.ts` + `api/queries/chat.queries.ts`); the realtime bridge is a live Socket.IO client; sends flow over the socket; the org chat is camp-scoped with server-known coordinator gating (`useMyRole`). Point to this plan + the spec.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-22-realtime-chat.md CLAUDE.md src/lib/mocks/
git commit -m "docs(chat): plan + frontend CLAUDE.md realtime-chat section"
```

---

## Whole-feature verification (from the spec)

Run after both parts land. No test runner — manual, per both CLAUDE.md files.

1. `npm run typecheck` (backend) and `npm run validate` (frontend) both pass.
2. `npm run seed:demo`. Log in as two participants of the same group in two browser sessions; a message sent by one appears live for the other **without a refresh**. Reload → last-50 history persists.
3. Invite an organizer with `role: 'coordinator'` + a `groupId` targeting that same group (Task B8 curl). Accept the invite, open `/org/chat` group tab → it shows the **identical** thread the participants see, and posts land in it live for the participants.
4. A non-coordinator organizer sees the lock panel. A participant hitting `GET /camps/:id/chat/organizers/messages` directly gets `403`. A participant socket emitting `chat:send { channel: 'organizers' }` gets `chat:error { code: 'forbidden' }`.
5. Restart the backend mid-session; sockets reconnect and history reload produces the same last-50 (messages persisted; only presence resets).

## Risks carried from the spec (do not skip)

- **Vite `ws: true`** on `/socket.io` (F1) — without it the socket silently fails only in the browser.
- **Cross-origin cookies in prod** — if the API moves off the same-origin dev proxy, `SameSite=None; Secure` + CORS `origin` must cover the Socket.IO server too (the handshake carries the cookie).
- **In-memory presence** resets on restart and is single-process only. Acceptable now; revisit with any horizontal scaling.
- **Coordinator handoff race** — `PATCH .../group` changes rooms for future connections; an already-connected socket isn't force-rejoined until it reconnects. Note it; don't solve in the first pass.
