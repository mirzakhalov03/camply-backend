# Authentication & Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build cookie-based, server-side-session authentication and role-based authorization for `camply-backend`, and adapt the frontend's session plumbing to match.

**Architecture:** An httpOnly cookie carries an opaque random session id; the real session lives in a `sessions` MongoDB collection (revocable, TTL-expiring). Two composable middlewares enforce the hierarchy — `requireAuth` proves identity, `requireRole` checks rank. Participants authenticate by phone alone (OTP seam left for later); organization/organizer accounts use a bcrypt password.

**Tech Stack:** Express 5, Mongoose 9 (MongoDB), Zod 4, TypeScript (strict, CommonJS), `bcryptjs`, `cookie-parser`, `express-rate-limit`. Node `crypto` for token generation.

**Spec:** `docs/superpowers/specs/2026-07-11-auth-authorization-design.md`

## Global Constraints

- **No automated tests** — per the user's decision. Each task is verified manually (typecheck / build / curl) with the exact command and expected output shown. Do **not** add a test runner.
- **Never commit without the user's explicit permission** — the commit step in each task is a *checkpoint*: pause and ask before running `git commit`. (User's standing rule.)
- **Follow existing backend conventions exactly:** thin controllers (no try/catch — Express 5 auto-forwards), business logic in services, `throw new HttpError(status, msg)`, Zod validators + the `validate` middleware, and **import `z` from `../config/zod`** (never from `'zod'`) so OpenAPI metadata attaches.
- **Role guardrail (never violate):** `/auth/register` creates **only** `participant`; the client-sent `role` is ignored. Only the dev seed creates an `organization`; only an `organization` creates an `organizer`.
- **Never expose `passwordHash`** in any response.
- **TypeScript strict** is on — no `any` leaking into signatures where a real type exists.
- Prettier: no semicolons, single quotes, trailing commas, width 100 (matches existing files).

---

## File Structure

```
NEW  src/models/session.model.ts          the sessions collection (+ TTL index)
NEW  src/config/cookies.ts                 cookie name + set/clear option builders
NEW  src/types/express.d.ts                req.auth declaration merge
NEW  src/utils/phone.ts                    canonicalize UZ phone → +998E.164
NEW  src/validators/auth.validators.ts     register/login/createOrganizer schemas
NEW  src/services/session.services.ts      create / findLive / refresh / revoke sessions
NEW  src/services/auth.services.ts         register / login / createOrganizer
NEW  src/middlewares/auth.middleware.ts    requireAuth, requireRole
NEW  src/controllers/auth.controllers.ts   thin HTTP layer
NEW  src/routes/auth.routes.ts             /api/auth/* (+ rate limiter)
NEW  src/scripts/seedOrg.ts                dev-only first-organization seed
NEW  ../CLAUDE.md (backend root)           the backend agent guide (fills the gap)

EDIT src/models/user.model.ts              phone/role/password/profile fields
EDIT src/config/env.ts                     session + seed env vars
EDIT src/app.ts                            mount cookie-parser
EDIT src/routes/index.ts                   mount /auth; add org-only POST /organizers; drop /users demo
EDIT src/docs/openapi.ts                   document auth endpoints; drop User demo
EDIT package.json                          deps + seed script

DELETE src/routes/user.routes.ts           demo CRUD, superseded by real auth
DELETE src/controllers/user.controllers.ts
DELETE src/services/user.services.ts
DELETE src/validators/user.validators.ts

FRONTEND (camply-frontend):
EDIT src/api/axiosInstance.ts              withCredentials; remove Bearer interceptor
EDIT src/store/useAuthStore.ts             drop `token`; setSession({ user })
EDIT src/api/services/auth.service.ts      AuthSession = { user }
EDIT src/api/queries/auth.queries.ts       gate `me` on user, commit { user }
EDIT src/api/realtime/realtimeBridge.ts    drop token from WS URL (cookie rides handshake)
EDIT src/components/Onboarding.tsx         mock setSession → { user } shape
```

---

## Task 1: Dependencies, environment & cookie config

**Files:**
- Modify: `package.json`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Create: `src/config/cookies.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Produces: `env.SESSION_TTL_DAYS`, `env.SESSION_REFRESH_THRESHOLD_HOURS`, `env.SEED_ORG_PHONE?`, `env.SEED_ORG_PASSWORD?`; `SESSION_COOKIE_NAME`, `setCookieOptions()`, `clearCookieOptions()` from `config/cookies`.

- [ ] **Step 1: Install runtime + type dependencies**

```bash
cd camply-backend
npm install bcryptjs cookie-parser express-rate-limit
npm install -D @types/cookie-parser
```
(`bcryptjs` ships its own types; `express-rate-limit` ships its own types.)

- [ ] **Step 2: Add session + seed vars to `src/config/env.ts`**

Add these lines inside the `envSchema = z.object({ ... })`, after `CLIENT_ORIGIN`:

```ts
  // Session lifetime (cookie Max-Age + sessions.expiresAt), in days.
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  // How stale a session may get before an authenticated request slides it forward.
  SESSION_REFRESH_THRESHOLD_HOURS: z.coerce.number().default(24),
  // Used ONLY by `npm run seed:org` to provision the first organization.
  SEED_ORG_PHONE: z.string().optional(),
  SEED_ORG_PASSWORD: z.string().optional(),
```

- [ ] **Step 3: Document the new vars in `.env.example`**

Append:

```
SESSION_TTL_DAYS=30
SESSION_REFRESH_THRESHOLD_HOURS=24
# Only needed to run `npm run seed:org` (creates the first organization account)
SEED_ORG_PHONE=901112233
SEED_ORG_PASSWORD=change-me-strong-password
```

- [ ] **Step 4: Create `src/config/cookies.ts`**

```ts
import { env } from './env'

// One source of truth for the session cookie, so set + clear never drift.
export const SESSION_COOKIE_NAME = 'camply_sid'

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Shared attributes. `Secure` only in production so http://localhost works in dev.
// SameSite=Lax fits a same-origin PWA (dev goes through Vite's /api proxy).
const baseOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}

// For res.cookie(...) — includes Max-Age.
export const setCookieOptions = () => ({
  ...baseOptions,
  maxAge: env.SESSION_TTL_DAYS * MS_PER_DAY,
})

// For res.clearCookie(...) — MUST match baseOptions (no Max-Age) or the browser
// won't clear it.
export const clearCookieOptions = () => baseOptions
```

- [ ] **Step 5: Wire `cookie-parser` in `src/app.ts`**

Add the import at the top with the others:

```ts
import cookieParser from 'cookie-parser'
```

Add the middleware right after `app.use(express.json())`:

```ts
  app.use(cookieParser())
```

- [ ] **Step 6: Verify it compiles and boots**

```bash
npm run typecheck
```
Expected: no output, exit 0.

Then start the dev server and hit health:
```bash
npm run dev
# in another shell:
curl -s localhost:4000/api/health
```
Expected: `{"status":"ok","uptime":<number>}`. Stop the server (Ctrl-C).

- [ ] **Step 7: Commit** *(pause for user permission first)*

```bash
git add package.json package-lock.json .env.example src/config/env.ts src/config/cookies.ts src/app.ts
git commit -m "chore(auth): add auth deps, session/cookie config, cookie-parser"
```

---

## Task 2: User model, Session model & request typing

**Files:**
- Modify: `src/models/user.model.ts`
- Create: `src/models/session.model.ts`
- Create: `src/types/express.d.ts`
- Delete: `src/validators/user.validators.ts`, `src/services/user.services.ts`, `src/controllers/user.controllers.ts`, `src/routes/user.routes.ts`
- Modify: `src/routes/index.ts` (drop the `/users` mount only), `src/docs/openapi.ts` (drop User demo paths only)

**Interfaces:**
- Produces: `UserModel`, `USER_ROLES`, `type User`; `SessionModel`, `type Session`; `req.auth?: { user, session }`.

- [ ] **Step 1: Rewrite `src/models/user.model.ts`**

```ts
import { Schema, model, type InferSchemaType } from 'mongoose'

// The role hierarchy (Context.md §3). Exported so validators, sessions, and the
// authorization middleware share one source of truth.
export const USER_ROLES = ['participant', 'organizer', 'organization'] as const

const userSchema = new Schema(
  {
    // Canonical E.164, e.g. +998901234567. The identity key — unique per person.
    phone: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    surname: { type: String, required: true, trim: true },
    role: { type: String, enum: USER_ROLES, default: 'participant', required: true },
    // Participant profile fields (the frontend registration form sends these).
    cityId: { type: String, trim: true },
    age: { type: Number },
    photo: { type: String, default: null },
    // Only org/organizer accounts have a password; participants sign in by phone.
    // select:false keeps it out of every query unless explicitly requested.
    passwordHash: { type: String, select: false },
  },
  { timestamps: true },
)

export type User = InferSchemaType<typeof userSchema>

export const UserModel = model('User', userSchema)
```

- [ ] **Step 2: Create `src/models/session.model.ts`**

```ts
import { Schema, model, type InferSchemaType } from 'mongoose'
import { USER_ROLES } from './user.model'

const sessionSchema = new Schema(
  {
    // sha256 of the raw cookie value. The raw token exists ONLY in the cookie;
    // storing the hash means a DB leak can't replay live sessions.
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Snapshot of the role at session creation (convenience; User is authoritative).
    role: { type: String, enum: USER_ROLES, required: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true, default: Date.now },
    userAgent: { type: String },
  },
  { timestamps: true },
)

// TTL index: Mongo auto-deletes a session the moment expiresAt passes — no cron.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type Session = InferSchemaType<typeof sessionSchema>

export const SessionModel = model('Session', sessionSchema)
```

- [ ] **Step 3: Create `src/types/express.d.ts`**

```ts
import type { HydratedDocument } from 'mongoose'
import type { User } from '../models/user.model'
import type { Session } from '../models/session.model'

// Declaration merge: after requireAuth runs, every handler can read a typed
// req.auth. Optional because unauthenticated routes never set it.
declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: HydratedDocument<User>
        session: HydratedDocument<Session>
      }
    }
  }
}

export {}
```

- [ ] **Step 4: Delete the demo `user` CRUD slice**

These were scaffold placeholders built on the old `name + email` model, which no longer exists. Remove them:

```bash
git rm src/validators/user.validators.ts src/services/user.services.ts src/controllers/user.controllers.ts src/routes/user.routes.ts
```

- [ ] **Step 5: Drop the `/users` mount from `src/routes/index.ts`**

Remove the `import userRoutes from './user.routes'` line and the `router.use('/users', userRoutes)` line. Leave `/health` intact. (The auth routes get added in Task 7 — for now the file should just be health.)

Resulting file:

```ts
import { Router } from 'express'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

export default router
```

- [ ] **Step 6: Drop the User demo from `src/docs/openapi.ts`**

Remove the `import { createUserSchema, userIdParamSchema } from '../validators/user.validators'` line, the `UserSchema`/`CreateUserSchema` `registry.register(...)` blocks, and the three `registerPath` blocks for `/api/users*`. Keep the `/api/health` path and `buildOpenApiDocument()`. (Auth paths are added in Task 8.)

- [ ] **Step 7: Verify it compiles**

```bash
npm run typecheck
```
Expected: no output, exit 0. (If the compiler complains about a missing `user.*` import, a reference in Step 5/6 was missed — remove it.)

- [ ] **Step 8: Commit** *(pause for user permission first)*

```bash
git add -A
git commit -m "feat(auth): user/session models, req.auth typing; remove demo user CRUD"
```

---

## Task 3: Phone canonicalization & auth validators

**Files:**
- Create: `src/utils/phone.ts`
- Create: `src/validators/auth.validators.ts`

**Interfaces:**
- Produces: `canonicalizePhone(raw): string`; `registerSchema`, `loginSchema`, `createOrganizerSchema` and their inferred types `RegisterInput`, `LoginInput`, `CreateOrganizerInput`.

- [ ] **Step 1: Create `src/utils/phone.ts`**

```ts
// Uzbekistan is the first market: national numbers are 9 digits (e.g. 901234567).
// We store the canonical E.164 form so uniqueness is unambiguous no matter how
// the client formatted the input.
const UZ_COUNTRY_CODE = '+998'

export function canonicalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  // Tolerate a leading country code if it ever arrives; keep the 9 national digits.
  const national = digits.startsWith('998') ? digits.slice(3) : digits
  return `${UZ_COUNTRY_CODE}${national}`
}
```

- [ ] **Step 2: Create `src/validators/auth.validators.ts`**

```ts
import { z } from '../config/zod'

// 9 national digits — matches the frontend's PHONE_LENGTH.
const phone = z.string().regex(/^\d{9}$/, 'Phone must be 9 digits')

export const registerSchema = z.object({
  phone,
  name: z.string().min(1).max(60),
  surname: z.string().min(1).max(60),
  cityId: z.string().min(1),
  age: z.coerce.number().int().min(1).max(120),
  photo: z.string().nullish(),
})

// Password is optional: participants omit it, org/organizer include it.
export const loginSchema = z.object({
  phone,
  password: z.string().min(1).optional(),
})

export const createOrganizerSchema = z.object({
  phone,
  name: z.string().min(1).max(60),
  surname: z.string().min(1).max(60),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type CreateOrganizerInput = z.infer<typeof createOrganizerSchema>
```

- [ ] **Step 3: Verify it compiles**

```bash
npm run typecheck
```
Expected: no output, exit 0.

- [ ] **Step 4: Commit** *(pause for user permission first)*

```bash
git add src/utils/phone.ts src/validators/auth.validators.ts
git commit -m "feat(auth): phone canonicalization + auth request validators"
```

---

## Task 4: Session service

**Files:**
- Create: `src/services/session.services.ts`

**Interfaces:**
- Consumes: `SessionModel` (Task 2), `env` (Task 1).
- Produces: `sessionService.create(userId, role, userAgent?) => Promise<string>` (returns the RAW cookie token), `sessionService.findLive(rawToken) => Promise<HydratedDocument<Session> | null>`, `sessionService.refreshIfStale(session) => Promise<void>`, `sessionService.revoke(rawToken) => Promise<...>`, `sessionService.revokeAllForUser(userId) => Promise<...>`.

- [ ] **Step 1: Create `src/services/session.services.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto'
import type { HydratedDocument, Types } from 'mongoose'
import { SessionModel, type Session } from '../models/session.model'
import { USER_ROLES } from '../models/user.model'
import { env } from '../config/env'

type Role = (typeof USER_ROLES)[number]

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_HOUR = 60 * 60 * 1000

// The cookie carries the raw token; the DB stores only this hash.
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function newExpiry(): Date {
  return new Date(Date.now() + env.SESSION_TTL_DAYS * MS_PER_DAY)
}

export const sessionService = {
  // Create a session and return the RAW token to put in the cookie.
  create: async (userId: Types.ObjectId, role: Role, userAgent?: string): Promise<string> => {
    const rawToken = randomBytes(32).toString('base64url')
    await SessionModel.create({
      tokenHash: hashToken(rawToken),
      userId,
      role,
      expiresAt: newExpiry(),
      lastSeenAt: new Date(),
      userAgent,
    })
    return rawToken
  },

  // Find a non-expired session by the raw cookie value, or null.
  findLive: async (rawToken: string): Promise<HydratedDocument<Session> | null> => {
    const session = await SessionModel.findOne({ tokenHash: hashToken(rawToken) })
    if (!session) return null
    if (session.expiresAt.getTime() <= Date.now()) return null
    return session
  },

  // Sliding refresh: only writes when the session has gone stale, to avoid a DB
  // write on every request.
  refreshIfStale: async (session: HydratedDocument<Session>): Promise<void> => {
    const staleAfterMs = env.SESSION_REFRESH_THRESHOLD_HOURS * MS_PER_HOUR
    if (Date.now() - session.lastSeenAt.getTime() < staleAfterMs) return
    session.lastSeenAt = new Date()
    session.expiresAt = newExpiry()
    await session.save()
  },

  revoke: (rawToken: string) => SessionModel.deleteOne({ tokenHash: hashToken(rawToken) }),

  revokeAllForUser: (userId: Types.ObjectId) => SessionModel.deleteMany({ userId }),
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```
Expected: no output, exit 0.

- [ ] **Step 3: Commit** *(pause for user permission first)*

```bash
git add src/services/session.services.ts
git commit -m "feat(auth): session service (create/find/refresh/revoke)"
```

---

## Task 5: Auth service

**Files:**
- Create: `src/services/auth.services.ts`

**Interfaces:**
- Consumes: `UserModel` (Task 2), `HttpError` (existing), `canonicalizePhone` (Task 3), `sessionService` (Task 4), the input types (Task 3).
- Produces: `authService.register(input, userAgent?) => Promise<{ token, user }>`, `authService.login(input, userAgent?) => Promise<{ token, user }>`, `authService.createOrganizer(input) => Promise<PublicUser>`, and `type PublicUser = { id, phone, name, surname, role }`.

- [ ] **Step 1: Create `src/services/auth.services.ts`**

```ts
import bcrypt from 'bcryptjs'
import type { HydratedDocument } from 'mongoose'
import { UserModel, type User } from '../models/user.model'
import { HttpError } from '../middlewares/error.middleware'
import { canonicalizePhone } from '../utils/phone'
import { sessionService } from './session.services'
import type {
  RegisterInput,
  LoginInput,
  CreateOrganizerInput,
} from '../validators/auth.validators'

const BCRYPT_ROUNDS = 12

export type PublicUser = {
  id: string
  phone: string
  name: string
  surname: string
  role: (typeof import('../models/user.model'))['USER_ROLES'][number]
}

// The ONLY shape that leaves the server — passwordHash never appears here.
function toPublicUser(user: HydratedDocument<User>): PublicUser {
  return {
    id: String(user._id),
    phone: user.phone,
    name: user.name,
    surname: user.surname,
    role: user.role,
  }
}

export const authService = {
  register: async (input: RegisterInput, userAgent?: string) => {
    const phone = canonicalizePhone(input.phone)
    const exists = await UserModel.exists({ phone })
    if (exists) throw new HttpError(409, 'Phone already registered')

    // Role is PINNED to participant. Never trust a client-sent role (guardrail).
    const user = await UserModel.create({
      phone,
      name: input.name,
      surname: input.surname,
      cityId: input.cityId,
      age: input.age,
      photo: input.photo ?? null,
      role: 'participant',
    })

    const token = await sessionService.create(user._id, 'participant', userAgent)
    return { token, user: toPublicUser(user) }
  },

  login: async (input: LoginInput, userAgent?: string) => {
    const phone = canonicalizePhone(input.phone)
    // passwordHash is select:false, so pull it explicitly for the check.
    const user = await UserModel.findOne({ phone }).select('+passwordHash')
    if (!user) throw new HttpError(401, 'Invalid credentials')

    // Org/organizer accounts require a password; participants sign in by phone alone.
    if (user.passwordHash) {
      if (!input.password) throw new HttpError(401, 'Password required')
      const ok = await bcrypt.compare(input.password, user.passwordHash)
      if (!ok) throw new HttpError(401, 'Invalid credentials')
    }

    const token = await sessionService.create(user._id, user.role, userAgent)
    return { token, user: toPublicUser(user) }
  },

  // Called by the org-only POST /organizers route (authorization enforced there).
  createOrganizer: async (input: CreateOrganizerInput): Promise<PublicUser> => {
    const phone = canonicalizePhone(input.phone)
    const exists = await UserModel.exists({ phone })
    if (exists) throw new HttpError(409, 'Phone already registered')

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
    const user = await UserModel.create({
      phone,
      name: input.name,
      surname: input.surname,
      role: 'organizer',
      passwordHash,
    })
    return toPublicUser(user)
  },
}
```

> Note on `PublicUser.role`: if the `import(...)` type expression trips the linter, replace the `role` line with `role: 'participant' | 'organizer' | 'organization'` — the values are fixed by `USER_ROLES`.

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```
Expected: no output, exit 0.

- [ ] **Step 3: Commit** *(pause for user permission first)*

```bash
git add src/services/auth.services.ts
git commit -m "feat(auth): auth service (register/login/createOrganizer)"
```

---

## Task 6: Authorization middleware

**Files:**
- Create: `src/middlewares/auth.middleware.ts`

**Interfaces:**
- Consumes: `UserModel`, `USER_ROLES` (Task 2), `sessionService` (Task 4), `HttpError` (existing), `SESSION_COOKIE_NAME` (Task 1), `req.auth` typing (Task 2).
- Produces: `requireAuth: RequestHandler`, `requireRole(min: Role): RequestHandler`.

- [ ] **Step 1: Create `src/middlewares/auth.middleware.ts`**

```ts
import type { RequestHandler } from 'express'
import { UserModel, USER_ROLES } from '../models/user.model'
import { sessionService } from '../services/session.services'
import { HttpError } from './error.middleware'
import { SESSION_COOKIE_NAME } from '../config/cookies'

type Role = (typeof USER_ROLES)[number]

// Higher rank = more authority. requireRole(min) passes when rank >= RANK[min].
const RANK: Record<Role, number> = { participant: 1, organizer: 2, organization: 3 }

// AUTHENTICATION — "who are you?". Reads the session cookie, loads the user,
// attaches req.auth. Throws 401 on any failure. (Express 5 forwards async throws.)
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined
  if (!rawToken) throw new HttpError(401, 'Not authenticated')

  const session = await sessionService.findLive(rawToken)
  if (!session) throw new HttpError(401, 'Session expired')

  const user = await UserModel.findById(session.userId)
  if (!user) throw new HttpError(401, 'Not authenticated')

  await sessionService.refreshIfStale(session)
  req.auth = { user, session }
  next()
}

// AUTHORIZATION — "what may you do?". Compose AFTER requireAuth.
export const requireRole =
  (min: Role): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) throw new HttpError(401, 'Not authenticated')
    if (RANK[req.auth.user.role] < RANK[min]) {
      throw new HttpError(403, 'Insufficient permissions')
    }
    next()
  }
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```
Expected: no output, exit 0.

- [ ] **Step 3: Commit** *(pause for user permission first)*

```bash
git add src/middlewares/auth.middleware.ts
git commit -m "feat(auth): requireAuth + requireRole middleware"
```

---

## Task 7: Controllers, routes & wiring (endpoints go live)

**Files:**
- Create: `src/controllers/auth.controllers.ts`
- Create: `src/routes/auth.routes.ts`
- Modify: `src/routes/index.ts`

**Interfaces:**
- Consumes: `authService` (Task 5), `sessionService` (Task 4), cookie helpers (Task 1), validators (Task 3), middlewares (Task 6).
- Produces: live endpoints `POST /api/auth/register|login|logout|logout-all`, `GET /api/auth/me`, `POST /api/organizers`.

- [ ] **Step 1: Create `src/controllers/auth.controllers.ts`**

```ts
import type { RequestHandler } from 'express'
import { authService } from '../services/auth.services'
import { sessionService } from '../services/session.services'
import {
  SESSION_COOKIE_NAME,
  setCookieOptions,
  clearCookieOptions,
} from '../config/cookies'

export const register: RequestHandler = async (req, res) => {
  const { token, user } = await authService.register(req.body, req.get('user-agent'))
  res.cookie(SESSION_COOKIE_NAME, token, setCookieOptions())
  res.status(201).json({ user })
}

export const login: RequestHandler = async (req, res) => {
  const { token, user } = await authService.login(req.body, req.get('user-agent'))
  res.cookie(SESSION_COOKIE_NAME, token, setCookieOptions())
  res.json({ user })
}

// req.auth is guaranteed by requireAuth on this route.
export const me: RequestHandler = async (req, res) => {
  const user = req.auth!.user
  res.json({
    id: String(user._id),
    phone: user.phone,
    name: user.name,
    surname: user.surname,
    role: user.role,
  })
}

export const logout: RequestHandler = async (req, res) => {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined
  if (rawToken) await sessionService.revoke(rawToken)
  res.clearCookie(SESSION_COOKIE_NAME, clearCookieOptions())
  res.status(204).end()
}

export const logoutAll: RequestHandler = async (req, res) => {
  await sessionService.revokeAllForUser(req.auth!.user._id)
  res.clearCookie(SESSION_COOKIE_NAME, clearCookieOptions())
  res.status(204).end()
}

export const createOrganizer: RequestHandler = async (req, res) => {
  const user = await authService.createOrganizer(req.body)
  res.status(201).json({ user })
}
```

- [ ] **Step 2: Create `src/routes/auth.routes.ts`**

```ts
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth } from '../middlewares/auth.middleware'
import { registerSchema, loginSchema } from '../validators/auth.validators'
import { register, login, me, logout, logoutAll } from '../controllers/auth.controllers'

// Blunt brute-force / phone enumeration on the credential-less participant flow.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again later' },
})

const router = Router()

router.post('/register', authLimiter, validate({ body: registerSchema }), register)
router.post('/login', authLimiter, validate({ body: loginSchema }), login)
router.get('/me', requireAuth, me)
router.post('/logout', requireAuth, logout)
router.post('/logout-all', requireAuth, logoutAll)

export default router
```

- [ ] **Step 3: Wire routes in `src/routes/index.ts`**

```ts
import { Router } from 'express'
import authRoutes from './auth.routes'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { validate } from '../middlewares/validate.middleware'
import { createOrganizerSchema } from '../validators/auth.validators'
import { createOrganizer } from '../controllers/auth.controllers'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

router.use('/auth', authRoutes)

// Organization-only: create an organizer. Authorization enforced server-side.
router.post(
  '/organizers',
  requireAuth,
  requireRole('organization'),
  validate({ body: createOrganizerSchema }),
  createOrganizer,
)

export default router
```

- [ ] **Step 4: Verify the full participant flow end-to-end**

Start MongoDB and the dev server (`npm run dev`). Then, using a cookie jar so the session cookie carries between calls:

```bash
# Register a participant → 201 + Set-Cookie
curl -i -c /tmp/camply.jar -X POST localhost:4000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"phone":"901234567","name":"Ali","surname":"Valiyev","cityId":"tashkent","age":17}'
```
Expected: `HTTP/1.1 201`, a `Set-Cookie: camply_sid=...; HttpOnly; ...` header, body `{"user":{"id":"...","phone":"+998901234567","name":"Ali","surname":"Valiyev","role":"participant"}}`.

```bash
# me → the same user, using the stored cookie
curl -s -b /tmp/camply.jar localhost:4000/api/auth/me
```
Expected: `{"id":"...","phone":"+998901234567","name":"Ali","surname":"Valiyev","role":"participant"}`.

```bash
# me WITHOUT the cookie → 401
curl -s -o /dev/null -w "%{http_code}\n" localhost:4000/api/auth/me
```
Expected: `401`.

```bash
# login the same phone (no password) → 200 + fresh cookie
curl -i -X POST localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"phone":"901234567"}'
```
Expected: `HTTP/1.1 200`, `Set-Cookie`, body `{"user":{...,"role":"participant"}}`.

```bash
# duplicate register → 409
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"phone":"901234567","name":"X","surname":"Y","cityId":"z","age":20}'
```
Expected: `409`.

```bash
# role escalation attempt is ignored → still participant
curl -s -X POST localhost:4000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"phone":"905550000","name":"Eve","surname":"Hacker","cityId":"z","age":30,"role":"organization"}'
```
Expected: body role is `"participant"`, NOT `"organization"`.

```bash
# logout → 204, then me → 401
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/camply.jar -X POST localhost:4000/api/auth/logout
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/camply.jar localhost:4000/api/auth/me
```
Expected: `204` then `401`.

Stop the server.

- [ ] **Step 5: Commit** *(pause for user permission first)*

```bash
git add src/controllers/auth.controllers.ts src/routes/auth.routes.ts src/routes/index.ts
git commit -m "feat(auth): auth endpoints, rate limiting, org-only createOrganizer"
```

---

## Task 8: OpenAPI documentation

**Files:**
- Modify: `src/docs/openapi.ts`

**Interfaces:**
- Consumes: the validator schemas (Task 3).

- [ ] **Step 1: Rewrite `src/docs/openapi.ts` to document auth**

Replace the file body (keeping the health path and `buildOpenApiDocument`) with:

```ts
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { z } from '../config/zod'
import { registerSchema, loginSchema, createOrganizerSchema } from '../validators/auth.validators'

const registry = new OpenAPIRegistry()

// ── Reusable component schemas ────────────────────────────────────────────
const PublicUserSchema = registry.register(
  'PublicUser',
  z.object({
    id: z.string().openapi({ example: '665f1b2c9d1e4a0012a3b4c5' }),
    phone: z.string().openapi({ example: '+998901234567' }),
    name: z.string().openapi({ example: 'Ali' }),
    surname: z.string().openapi({ example: 'Valiyev' }),
    role: z.enum(['participant', 'organizer', 'organization']).openapi({ example: 'participant' }),
  }),
)

const SessionResponse = z.object({ user: PublicUserSchema })

const RegisterInput = registry.register('RegisterInput', registerSchema)
const LoginInput = registry.register('LoginInput', loginSchema)
const CreateOrganizerInput = registry.register('CreateOrganizerInput', createOrganizerSchema)

// ── Paths ─────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get',
  path: '/api/health',
  tags: ['System'],
  summary: 'Health check',
  responses: {
    200: {
      description: 'Service is up',
      content: {
        'application/json': { schema: z.object({ status: z.string(), uptime: z.number() }) },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/register',
  tags: ['Auth'],
  summary: 'Register a participant (role is always participant)',
  request: { body: { content: { 'application/json': { schema: RegisterInput } } } },
  responses: {
    201: {
      description: 'Session started; sets the camply_sid cookie',
      content: { 'application/json': { schema: SessionResponse } },
    },
    409: { description: 'Phone already registered' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  tags: ['Auth'],
  summary: 'Log in (participant: phone only; org/organizer: phone + password)',
  request: { body: { content: { 'application/json': { schema: LoginInput } } } },
  responses: {
    200: {
      description: 'Session started; sets the camply_sid cookie',
      content: { 'application/json': { schema: SessionResponse } },
    },
    401: { description: 'Invalid credentials' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  tags: ['Auth'],
  summary: 'The authenticated user',
  responses: {
    200: { description: 'Current user', content: { 'application/json': { schema: PublicUserSchema } } },
    401: { description: 'Not authenticated' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  tags: ['Auth'],
  summary: 'Log out this session',
  responses: { 204: { description: 'Logged out' }, 401: { description: 'Not authenticated' } },
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/logout-all',
  tags: ['Auth'],
  summary: 'Log out every session for this user',
  responses: { 204: { description: 'Logged out everywhere' }, 401: { description: 'Not authenticated' } },
})

registry.registerPath({
  method: 'post',
  path: '/api/organizers',
  tags: ['Auth'],
  summary: 'Create an organizer (organization only)',
  request: { body: { content: { 'application/json': { schema: CreateOrganizerInput } } } },
  responses: {
    201: { description: 'Organizer created', content: { 'application/json': { schema: SessionResponse } } },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    409: { description: 'Phone already registered' },
  },
})

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions)
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Camply API',
      version: '1.0.0',
      description: 'API documentation for the Camply backend.',
    },
    servers: [{ url: 'http://localhost:4000' }],
  })
}
```

- [ ] **Step 2: Verify the docs render**

```bash
npm run typecheck
npm run dev
# then:
curl -s localhost:4000/api/docs.json | grep -o '"/api/auth/[a-z-]*"' | sort -u
```
Expected: lists `/api/auth/login`, `/api/auth/logout`, `/api/auth/logout-all`, `/api/auth/me`, `/api/auth/register`. Open `http://localhost:4000/api/docs` in a browser to see the Auth section. Stop the server.

- [ ] **Step 3: Commit** *(pause for user permission first)*

```bash
git add src/docs/openapi.ts
git commit -m "docs(auth): OpenAPI paths for auth endpoints"
```

---

## Task 9: Dev seed for the first organization

**Files:**
- Create: `src/scripts/seedOrg.ts`
- Modify: `package.json` (add `seed:org` script)

**Interfaces:**
- Consumes: `connectDB`, `env`, `UserModel`, `canonicalizePhone`.

- [ ] **Step 1: Create `src/scripts/seedOrg.ts`**

```ts
import 'dotenv/config'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { connectDB } from '../config/db'
import { env } from '../config/env'
import { UserModel } from '../models/user.model'
import { canonicalizePhone } from '../utils/phone'

// Dev-only: provisions the single organization super-admin. There is NO public
// path to become an organization (Context.md guardrail).
async function seedOrg() {
  if (!env.SEED_ORG_PHONE || !env.SEED_ORG_PASSWORD) {
    console.error('❌ Set SEED_ORG_PHONE and SEED_ORG_PASSWORD in .env first')
    process.exit(1)
  }

  await connectDB()
  const phone = canonicalizePhone(env.SEED_ORG_PHONE)

  const existing = await UserModel.findOne({ phone })
  if (existing) {
    console.log('ℹ️  Organization already exists:', phone)
    await mongoose.disconnect()
    return
  }

  const passwordHash = await bcrypt.hash(env.SEED_ORG_PASSWORD, 12)
  await UserModel.create({
    phone,
    name: 'Camply',
    surname: 'Organization',
    role: 'organization',
    passwordHash,
  })
  console.log('✅ Organization seeded:', phone)
  await mongoose.disconnect()
}

seedOrg()
```

- [ ] **Step 2: Add the script to `package.json`**

Add to `"scripts"`:

```json
    "seed:org": "tsx src/scripts/seedOrg.ts",
```

- [ ] **Step 3: Verify the seed + org login + authorization**

Set `SEED_ORG_PHONE` / `SEED_ORG_PASSWORD` in `.env`, then:

```bash
npm run seed:org
```
Expected: `✅ Organization seeded: +998...`.

Start `npm run dev`. Log in as the org and create an organizer:

```bash
# org login WITH password → 200
curl -i -c /tmp/org.jar -X POST localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"901112233","password":"<your SEED_ORG_PASSWORD>"}'
```
Expected: `200`, body role `"organization"`.

```bash
# org login with WRONG password → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"phone":"901112233","password":"wrong"}'
```
Expected: `401`.

```bash
# org creates an organizer → 201
curl -i -b /tmp/org.jar -X POST localhost:4000/api/organizers \
  -H 'Content-Type: application/json' \
  -d '{"phone":"907778899","name":"Org","surname":"Aniz","password":"organizerpass1"}'
```
Expected: `201`, body role `"organizer"`.

```bash
# a participant trying to create an organizer → 403
# (reuse the participant cookie jar from Task 7, or register a fresh participant first)
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/camply.jar -X POST localhost:4000/api/organizers \
  -H 'Content-Type: application/json' \
  -d '{"phone":"901010101","name":"No","surname":"Way","password":"whatever12"}'
```
Expected: `403`.

Stop the server.

- [ ] **Step 4: Commit** *(pause for user permission first)*

```bash
git add src/scripts/seedOrg.ts package.json
git commit -m "feat(auth): dev seed for the first organization"
```

---

## Task 10: Frontend — switch to the cookie model

**Files (in `camply-frontend`):**
- Modify: `src/api/axiosInstance.ts`
- Modify: `src/store/useAuthStore.ts`
- Modify: `src/api/services/auth.service.ts`
- Modify: `src/api/queries/auth.queries.ts`
- Modify: `src/api/realtime/realtimeBridge.ts`
- Modify: `src/components/Onboarding.tsx`

**Interfaces:**
- The backend now returns `{ user }` (no token) and sets an httpOnly cookie. The store no longer holds a token; the cookie is the credential.

- [ ] **Step 1: `axiosInstance.ts` — send cookies, drop the Bearer interceptor**

Add `withCredentials: true` to the `axios.create({...})` config:

```ts
export const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 15_000,
  withCredentials: true, // send/receive the httpOnly session cookie
  headers: { 'Content-Type': 'application/json' },
})
```

Delete the entire request interceptor block (the `axiosInstance.interceptors.request.use(...)` that attaches `Authorization: Bearer`). Keep the **response** interceptor exactly as-is (401 → `clear()`).

- [ ] **Step 2: `useAuthStore.ts` — drop `token`**

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/*
  CLIENT state — WHO you are. The credential itself is the backend's httpOnly
  session cookie (not readable by JS), so the store no longer holds a token; it
  only mirrors the identity the backend returns at login for instant UI use.
  Persisted so the identity survives a reload; the cookie keeps the session live.
*/
export type AuthRole = 'participant' | 'organizer' | 'organization'

export type AuthUser = {
  id: string
  phone: string
  name: string
  surname: string
  role: AuthRole
}

type AuthState = {
  user: AuthUser | null
  /** Commit a fresh session (called from useLogin / useRegister on success). */
  setSession: (session: { user: AuthUser }) => void
  /** Drop the identity — log out, or a 401 from the response interceptor. */
  clear: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setSession: ({ user }) => set({ user }),
      clear: () => set({ user: null }),
    }),
    { name: 'camply-auth' },
  ),
)
```

- [ ] **Step 3: `auth.service.ts` — `AuthSession` is just `{ user }`**

Change the `AuthSession` type and keep the calls (they already read `res.data`):

```ts
/** Both login and register return the identity; the session lives in the cookie. */
export type AuthSession = { user: AuthUser }
```

Also update the comment on `RegisterRequest.role` to note it is ignored server-side:

```ts
  /** Sent by the form but IGNORED by the backend — /register always creates a participant. */
  role: AuthRole
```

- [ ] **Step 4: `auth.queries.ts` — commit `{ user }`, gate `me` on the user**

In `useLogin` and `useRegister`, the `onSuccess` already receives `session`; it now has `session.user` only — `setSession(session)` still works because `setSession` takes `{ user }`. No change needed there beyond confirming it compiles.

Change `useCurrentUser` to gate on the stored user instead of a token:

```ts
export function useCurrentUser() {
  const user = useAuthStore((s) => s.user)
  return useQuery({
    queryKey: authKeys.me,
    queryFn: authService.me,
    enabled: Boolean(user),
  })
}
```

- [ ] **Step 5: `realtimeBridge.ts` — drop the token from the WS URL**

The WebSocket handshake carries the httpOnly cookie automatically (same origin), so the `token` query param is obsolete. Replace the two token lines:

```ts
  // The session cookie authenticates the WS handshake (same-origin); no token param.
  socket = new WebSocket(`${WS_URL}?campId=${campId}`)
```

Remove the now-unused `const token = useAuthStore.getState().token` line above it. (If `useAuthStore` is no longer referenced in this file, drop its import to satisfy `noUnusedLocals`.)

- [ ] **Step 6: `Onboarding.tsx:~85` — fix the mock `setSession` call**

Find the `setSession({ token: 'mock-organizer-session', ... })` call and remove the `token` field so it matches the new `{ user }` signature:

```ts
setSession({
  user: {
    // ...the existing mock user fields (id, phone, name, surname, role)...
  },
})
```
(Keep whatever `user` object was there; just delete the `token` property.)

- [ ] **Step 7: Verify the frontend compiles**

```bash
cd ../camply-frontend
npm run typecheck
```
Expected: no output, exit 0. (A leftover `token` reference will fail here — fix it where it points.)

- [ ] **Step 8: Verify the real login flow against the backend**

Run the backend (`cd ../camply-backend && npm run dev`) and the frontend (`npm run dev`), open `http://localhost:5173`, complete the participant onboarding. In the browser devtools:
- **Application → Cookies → localhost:5173** shows `camply_sid` with `HttpOnly` ✓.
- **Application → Local Storage** `camply-auth` holds `user` but **no `token`** ✓.
- Reload the page — you stay logged in (the cookie persists the session).

- [ ] **Step 9: Commit** *(pause for user permission first)*

```bash
git add src/api/axiosInstance.ts src/store/useAuthStore.ts src/api/services/auth.service.ts src/api/queries/auth.queries.ts src/api/realtime/realtimeBridge.ts src/components/Onboarding.tsx
git commit -m "feat(auth): switch frontend to httpOnly cookie session"
```

---

## Task 11: Backend agent guide (`camply-backend/CLAUDE.md`)

**Files:**
- Create: `camply-backend/CLAUDE.md`

The root `CLAUDE.md` points to `backend/CLAUDE.md`, which doesn't exist yet. This task fills the gap and documents the auth system as the worked example, mirroring how the frontend guide documents its conventions.

- [ ] **Step 1: Create `camply-backend/CLAUDE.md`**

````markdown
# CLAUDE.md — camply-backend

The Express API for Camply. Product context (roles, guardrails) lives in the
monorepo root: `../CLAUDE.md` and `../CONTEXT.md`. **Read those guardrails before
touching auth or permissions.** This file covers the backend stack and conventions.

## Commands

- `npm run dev` — nodemon dev server on **:4000** (`MONGO_URI` must point at a
  running MongoDB).
- `npm run build` — `tsc` → `dist/`. `npm start` runs the build.
- `npm run typecheck` — `tsc --noEmit`, the primary per-change gate.
- `npm run lint` — **oxlint** (not ESLint). `npm run format` / `format:check` — Prettier.
- `npm run validate` — lint + format:check + typecheck (the pre-commit hook).
- `npm run seed:org` — dev-only: provisions the first `organization` from
  `SEED_ORG_PHONE` / `SEED_ORG_PASSWORD`.

No test runner is configured (project preference) — verify manually with curl or
`/api/docs`.

## Stack

Express 5 · Mongoose 9 (MongoDB) · Zod 4 · TypeScript (strict, CommonJS).
`@asteasolutions/zod-to-openapi` generates Swagger at `/api/docs`.

## Conventions (follow these exactly)

- **Layering:** `routes → controllers → services → models`. Controllers are
  **thin** (no try/catch — Express 5 forwards async throws to the error
  middleware). All business/data logic lives in **services**. Throw
  `new HttpError(status, message)` from anywhere.
- **Validation:** every input gets a Zod schema in `validators/`, applied via the
  `validate({ body, params, query })` middleware. **Import `z` from
  `config/zod`** (never `'zod'`) so `.openapi()` metadata attaches.
- **Env:** all config goes through `config/env.ts` (Zod-validated at boot). Never
  read `process.env` directly elsewhere.
- **Docs:** add a `registry.registerPath(...)` in `docs/openapi.ts` for every new
  endpoint, reusing validator schemas so docs can't drift.

## Authentication & authorization (the worked example)

- **Cookie sessions, server-side.** Login/register set an httpOnly cookie
  `camply_sid` holding an opaque random token; the real session lives in the
  `sessions` collection (`models/session.model.ts`) with a TTL index. Only the
  **sha256** of the token is stored — never the raw value.
- **Two middlewares, composed on every protected route** (`middlewares/auth.middleware.ts`):
  `requireAuth` (loads the session + user into `req.auth`) then `requireRole(min)`
  (rank check: participant < organizer < organization). Example:
  `router.post('/organizers', requireAuth, requireRole('organization'), ...)`.
- **Role guardrail:** `POST /auth/register` **always** creates a `participant` —
  the client-sent `role` is ignored. Organizations exist only via `npm run seed:org`;
  organizers only via the org-only `POST /organizers`. A hidden button is never a
  permission — the server is the sole authority.
- **Participants authenticate by phone alone** (no secret yet). The `/login` and
  `/register` handlers are shaped so an OTP verification step drops in later
  without changing `/me`, sessions, or authorization. Org/organizer accounts use a
  `bcryptjs` password (`passwordHash`, `select:false`, never returned).
- **Sessions:** sliding expiry (`sessionService.refreshIfStale`), instant
  revocation (`/logout`), and "log out everywhere" (`/logout-all`).

Design + plan: `docs/superpowers/specs/2026-07-11-auth-authorization-design.md`,
`docs/superpowers/plans/2026-07-11-auth-authorization.md`.

## Deploy caveat — cross-origin cookies

In dev the frontend reaches the API through Vite's `/api` proxy, so the cookie is
**same-origin** and `SameSite=Lax` works. If prod serves the API on a **different
origin** than the app, the session cookie needs `SameSite=None; Secure` and CORS
`credentials: true` with an explicit `origin` — update `config/cookies.ts` and the
`cors(...)` options together.

## Keep this file current

Update it in the same change whenever you alter architecture, conventions,
commands, or a cross-cutting pattern (a new middleware, a new layer rule).
````

- [ ] **Step 2: Verify**

Read the file back and confirm the commands match `package.json` (including `seed:org` from Task 9).

- [ ] **Step 3: Commit** *(pause for user permission first)*

```bash
git add CLAUDE.md
git commit -m "docs: backend agent guide with auth conventions"
```

---

## Self-Review — spec coverage

| Spec section | Covered by |
|---|---|
| §4.1 User model (phone/role/password/profile) | Task 2 |
| §4.2 Session model + TTL | Task 2 |
| §5 Cookie mechanics, sliding expiry, env vars | Tasks 1, 4 |
| §6 register / login / logout / logout-all / me / organizers | Tasks 5, 7 |
| §6 first-org seed, admin-reset posture | Task 9 |
| §7 requireAuth / requireRole | Task 6 |
| §8 rate limiting, bcrypt, phone canonicalization, hashed token | Tasks 3, 4, 5, 7 |
| §9 Frontend deltas | Task 10 |
| §10 New/changed files, deps, backend CLAUDE.md | Tasks 1–2, 11 |
| §11 Manual verification | curl steps in Tasks 7, 9; browser check in Task 10 |
| D4 role-pinning guardrail | Task 5 (service) + Task 7 verify |

**OTP seam (§8):** not built (out of scope) — the phone-first `/login` and
`/register` shapes leave room for a verification stage, as designed. No task
needed. **Self-service password reset (§12):** explicitly deferred.

**Type consistency check:** `sessionService.create` returns the raw token (string);
`authService` names it `token` and the controller sets it as the cookie —
consistent. `PublicUser`/`AuthUser` fields (`id, phone, name, surname, role`) match
across backend `toPublicUser`, the `/me` controller, and the frontend `AuthUser`.
`setSession({ user })` signature matches every caller after Task 10.
