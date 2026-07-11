# Organizer Invite-Based Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-step organizer creation with an emailed magic-link invite: the org invites by email; the organizer completes onboarding by entering their phone via the link and is logged straight into `/org`.

**Architecture:** Backend gains an `email` user field, an `Invite` token model (mirrors `Session`: hashed token + TTL), a nodemailer mailer (Ethereal in dev / SMTP in prod), a changed `POST /organizers` (email-only, sends invite) with `resend`/`revoke`, and public `GET /invite/:token` + `POST /invite/:token/accept` (accept sets a session cookie). Frontend switches the create sheet to email, shows organizer **status** (Pending/Active/Deactivated) with Resend/Revoke, adds a public `/invite/:token` accept page, and makes dashboard stats status-based.

**Tech Stack:** Backend — Express 5, Mongoose 9, Zod 4 (from `config/zod`), TypeScript strict CommonJS, nodemailer. Frontend — React 19, TypeScript, React Query, React Router, Tailwind v4.

**Companion spec:** `camply-backend/docs/superpowers/specs/2026-07-12-organizer-invite-onboarding-design.md` — read it for context, the flow diagram, and decision rationale.

## Global Constraints

- **No test runner** in either repo (project rule — don't add one). Per-task gate: `npm run typecheck` (pass) + manual verification (curl for backend, driving the app for frontend). Final gate per repo: `npm run validate` (lint + format:check + typecheck).
- **No git commit/push without explicit user permission** (project hard rule). Where a step says "commit," stage + prepare the message, but only commit once the user approves.
- **Backend conventions:** layering `routes → controllers → services → models`; controllers thin, **no try/catch** (Express 5 forwards async throws); throw `new HttpError(status, msg)` (from `middlewares/error.middleware`). Import `z` from **`config/zod`** in validators (never `'zod'`) so `.openapi()` attaches; apply via `validate({ body, params, query })`. Register every endpoint in `docs/openapi.ts`. All config via `config/env.ts` (never `process.env` elsewhere).
- **Auth/session:** raw token only in cookie/link; DB stores `sha256`. Cookie name + options from `config/cookies.ts` (`SESSION_COOKIE_NAME`, `setCookieOptions()`). `sessionService.create(userId, role, userAgent?)` returns the raw token. `canonicalizePhone(raw)` → `+998…`.
- **Frontend conventions:** server data through React Query only; never inline a query key (use `queryKeys.ts` factories); `import type` for type-only imports; no semicolons/single quotes/trailing commas/width 100 (Prettier); relative imports; design tokens only (no raw hex), dark mode must keep working; use `ui/` primitives. Trilingual — every string in UZ/RU/EN via `t.*`, no hard-coded copy.
- **Format only files you touch:** `npx prettier --write --end-of-line auto <files>` (repos have a CRLF caveat — never format the whole tree).

---

## Environment & operational context (read before running anything)

Facts verified 2026-07-12 by actually running the stack. A fresh session won't know these; they'll cost you an hour of confusion if you skip them.

**Repo layout.** Monorepo root `/Users/macbookuz/Desktop/Camply` is **not** a git repo; `camply-backend/` and `camply-frontend/` are **separate** git repos. This plan's docs live in the backend repo; the frontend tasks touch the frontend repo — `cd` into the right one before git/npm.

**Servers & ports.** Backend Express on **:4000** (`cd camply-backend && npm run dev`, needs MongoDB). Frontend Vite on **:5173** (`cd camply-frontend && npm run dev`), which **proxies `/api/*` → :4000** (`vite.config.ts`), so the browser hits same-origin and the session cookie is `SameSite=Lax`. All backend routes are mounted under **`/api`** (`app.use('/api', routes)`) — so it's `POST /api/organizers`, `GET /api/invite/:token`, etc. **The dev servers were already running in this environment** — check with `lsof -iTCP:4000 -sTCP:LISTEN` / `:5173` before starting duplicates; Vite HMR picks up edits live.

**MongoDB.** Local `mongodb://127.0.0.1:27017/camply` (running via Homebrew `mongod`). Inspect data with `mongosh "mongodb://127.0.0.1:27017/camply" --quiet --eval '...'`.

**Org login credentials (the nuance that bites).** The org logs in by **username `admin`**. The password is **`camply-dev-org-pass`** — it is set in `camply-backend/.env` as `SEED_ORG_PASSWORD` and is **NOT** the `1234` dev default in `env.ts`. Also: `.env` has a `SEED_ORG_PHONE` line — that's a **red herring**, the env schema doesn't read it; the org has no phone and logs in by username only. Re-seed if needed: `npm run seed:org` (idempotent — says "already exists" if present).

**Known seeded test data (why your curl may 409).** Phone uniqueness is across ALL users, but `GET /organizers` is role-filtered, so a phone can be "taken" while the organizers list looks empty. Existing users at last check: participants on `+998935556677 / 901234567 / 902345678 / 903456789`, one org (`admin`), and a leftover organizer **"Test Organizer" `+998977776655`** created during the prior task's verification. **Pick fresh phones** for accept-flow tests (e.g. `944445566`, `935551234`) and fresh emails for create. Query `db.users.find({}, {phone:1,email:1,role:1})` first if unsure.

**Recent related change (don't regress it).** The shared `Sheet` primitive (`camply-frontend/src/components/ui/Sheet.tsx`) was just fixed: its focus effect depends on **`[open]` only** and reads `onClose` via a ref (`onCloseRef`). This is why the create sheet's inputs keep focus while typing. **Do not add `onClose` back to that effect's dep array** — it re-introduces focus-theft-on-every-keystroke. The new invite create sheet (Task 7) and any sheet with text inputs rely on this.

**Mongo stale-index gotcha (for the new `email` field).** Mongoose does not drop indexes you stop declaring, and adding a `unique+sparse` index to a collection that already has documents is fine *unless* two existing docs would violate it. Since no user has `email` yet, the sparse index builds cleanly. If you ever see a spurious `E11000` on `email`, check for a stale index with `db.users.getIndexes()`. (The existing `phone` unique index stays — organizers still get a phone at accept-time.)

**Language default.** The frontend defaults to **Uzbek** (first locale). When driving it headlessly and matching button text, force English first (see Verification tooling below) or match the Uzbek strings.

---

## File Structure

**Backend — new:**
- `src/services/mailer.service.ts` — nodemailer transport (Ethereal/SMTP) + `sendOrganizerInvite`.
- `src/models/invite.model.ts` — invite token (hashed + TTL).
- `src/services/invite.services.ts` — createInvite / getPublicInvite / accept.
- `src/validators/invite.validators.ts` — accept body + token param.
- `src/controllers/invite.controllers.ts` — public get + accept (accept sets cookie).
- `src/routes/invite.routes.ts` — public `/invite` routes.

**Backend — modified:**
- `src/config/env.ts` — APP_URL, SMTP_*, MAIL_FROM, INVITE_TTL_DAYS.
- `src/models/user.model.ts` — `email` field.
- `src/validators/organizer.validators.ts` — create → `{name,surname,email}`.
- `src/services/organizer.services.ts` — email+status, create/resend/revoke.
- `src/controllers/organizer.controllers.ts` — create returns inviteUrl (dev), resend, revoke.
- `src/routes/organizer.routes.ts` — add resend + delete.
- `src/routes/index.ts` — mount `/invite`.
- `src/docs/openapi.ts` — register new endpoints.
- `package.json` — add `nodemailer`, `@types/nodemailer`.

**Frontend — new:**
- `src/api/services/invites.service.ts`, `src/api/queries/invites.queries.ts`
- `src/components/invite/InviteAcceptScreen.tsx`

**Frontend — modified:**
- `src/i18n/translations.ts`, `src/api/queryKeys.ts`,
  `src/api/services/organizers.service.ts`, `src/api/queries/organizers.queries.ts`,
  `src/components/organization/organizers/{NewOrganizerSheet,OrganizerRow}.tsx`,
  `src/components/organization/dashboard/DashboardScreen.tsx`, `src/App.tsx`.

---

# BACKEND

## Task 1: nodemailer + env + mailer service

**Files:**
- Modify: `package.json` (deps)
- Modify: `src/config/env.ts`
- Create: `src/services/mailer.service.ts`

**Interfaces:**
- Produces: `mailer.sendOrganizerInvite({ to, name, link }): Promise<{ previewUrl?: string }>`; `env.APP_URL`, `env.INVITE_TTL_DAYS`, `env.MAIL_FROM`, `env.SMTP_*`. Consumed by Tasks 3–4.

- [ ] **Step 1: Install nodemailer.**

Run: `cd camply-backend && npm install nodemailer && npm install -D @types/nodemailer`
Expected: both added to `package.json`.

- [ ] **Step 2: Add env vars.** In `src/config/env.ts`, add these to the `envSchema` object (after `SEED_ORG_PASSWORD`):

```ts
  // Invite emails (organizer onboarding). APP_URL is the frontend base for the
  // magic link. SMTP_* optional — if unset, dev uses a nodemailer Ethereal test
  // account (preview URL logged; no real delivery).
  APP_URL: z.string().default('http://localhost:5173'),
  MAIL_FROM: z.string().default('Camply <no-reply@camply.dev>'),
  INVITE_TTL_DAYS: z.coerce.number().default(7),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
```

- [ ] **Step 3: Create the mailer** `src/services/mailer.service.ts`:

```ts
import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../config/env'

/*
  The one mailer. Real SMTP transport when SMTP_HOST is configured; otherwise a
  nodemailer Ethereal test account in dev — the email is captured (not delivered)
  and getTestMessageUrl() gives a preview link we log. Flipping to real delivery is
  purely an env change (set SMTP_*), no code change. Transport is cached.
*/
let cached: Transporter | null = null

async function getTransport(): Promise<Transporter> {
  if (cached) return cached
  if (env.SMTP_HOST) {
    cached = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  } else {
    const test = await nodemailer.createTestAccount()
    cached = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: test.user, pass: test.pass },
    })
    console.log('✉️  Dev mailer: Ethereal test account (emails are NOT really delivered).')
  }
  return cached
}

export const mailer = {
  /** Send the organizer invite. Returns the Ethereal preview URL in dev (if any). */
  sendOrganizerInvite: async ({
    to,
    name,
    link,
  }: {
    to: string
    name: string
    link: string
  }): Promise<{ previewUrl?: string }> => {
    const transport = await getTransport()
    const info = await transport.sendMail({
      from: env.MAIL_FROM,
      to,
      subject: 'Camply — tashkilotchi taklifnomasi',
      text:
        `Salom ${name},\n\n` +
        `Siz Camply'ga tashkilotchi sifatida taklif qilindingiz. Kirish uchun ` +
        `quyidagi havolani oching va telefon raqamingizni kiriting:\n\n${link}\n\n` +
        `Havola 7 kun amal qiladi.`,
      html:
        `<p>Salom ${name},</p>` +
        `<p>Siz Camply'ga tashkilotchi sifatida taklif qilindingiz. Kirish uchun ` +
        `quyidagi havolani bosing va telefon raqamingizni kiriting:</p>` +
        `<p><a href="${link}">${link}</a></p>` +
        `<p>Havola 7 kun amal qiladi.</p>`,
    })
    const previewUrl = nodemailer.getTestMessageUrl(info) || undefined
    if (previewUrl) console.log('✉️  Invite email preview:', previewUrl)
    return { previewUrl }
  },
}
```

- [ ] **Step 4: Typecheck.** Run: `npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** (with permission).

```bash
npx prettier --write --end-of-line auto src/config/env.ts src/services/mailer.service.ts
git add package.json package-lock.json src/config/env.ts src/services/mailer.service.ts
git commit -m "feat(mail): add nodemailer mailer with Ethereal dev fallback"
```

---

## Task 2: user email field + Invite model + invite service

**Files:**
- Modify: `src/models/user.model.ts`
- Create: `src/models/invite.model.ts`
- Create: `src/services/invite.services.ts`

**Interfaces:**
- Consumes: `sessionService.create`, `toPublicUser`/`PublicUser` (`services/auth.services`), `canonicalizePhone`, `HttpError`, `env.INVITE_TTL_DAYS`.
- Produces: `InviteModel`; `inviteService.createInvite(userId, email): Promise<string>` (raw token), `inviteService.getPublicInvite(rawToken): Promise<{name,email}>`, `inviteService.accept(rawToken, phoneRaw, userAgent?): Promise<{token, user: PublicUser}>`. Consumed by Tasks 3–4.

- [ ] **Step 1: Add `email` to the user model.** In `src/models/user.model.ts`, add after the `username` field:

```ts
    // Organizers are invited by email (magic-link onboarding); sparse-unique so the
    // many phone-only users don't collide. Set at invite time; phone arrives on accept.
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
```

- [ ] **Step 2: Create the Invite model** `src/models/invite.model.ts`:

```ts
import { Schema, model, type InferSchemaType } from 'mongoose'

/*
  A one-time organizer invite token — mirrors session.model.ts. The raw token lives
  ONLY in the emailed link; we store its sha256 so a DB leak can't be replayed. The
  TTL index auto-purges expired invites (no cron). Deleted on accept (single-use).
*/
const inviteSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
)

inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type Invite = InferSchemaType<typeof inviteSchema>
export const InviteModel = model('Invite', inviteSchema)
```

- [ ] **Step 3: Create the invite service** `src/services/invite.services.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto'
import type { Types } from 'mongoose'
import { InviteModel } from '../models/invite.model'
import { UserModel } from '../models/user.model'
import { HttpError } from '../middlewares/error.middleware'
import { canonicalizePhone } from '../utils/phone'
import { sessionService } from './session.services'
import { toPublicUser, type PublicUser } from './auth.services'
import { env } from '../config/env'

const MS_PER_DAY = 24 * 60 * 60 * 1000
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export const inviteService = {
  /** Issue a fresh invite for a user, replacing any prior one. Returns the RAW token. */
  createInvite: async (userId: Types.ObjectId, email: string): Promise<string> => {
    await InviteModel.deleteMany({ userId })
    const rawToken = randomBytes(32).toString('base64url')
    await InviteModel.create({
      tokenHash: hashToken(rawToken),
      userId,
      email,
      expiresAt: new Date(Date.now() + env.INVITE_TTL_DAYS * MS_PER_DAY),
    })
    return rawToken
  },

  /** Public: what the accept screen shows. Throws 404 (invalid) / 410 (expired). */
  getPublicInvite: async (rawToken: string): Promise<{ name: string; email: string }> => {
    const invite = await InviteModel.findOne({ tokenHash: hashToken(rawToken) })
    if (!invite) throw new HttpError(404, 'Invalid invite')
    if (invite.expiresAt.getTime() <= Date.now()) throw new HttpError(410, 'Invite expired')
    const user = await UserModel.findById(invite.userId)
    if (!user) throw new HttpError(404, 'Invalid invite')
    return { name: user.name, email: invite.email }
  },

  /** Bind the phone, activate, delete the token, and start a session (log them in). */
  accept: async (
    rawToken: string,
    phoneRaw: string,
    userAgent?: string,
  ): Promise<{ token: string; user: PublicUser }> => {
    const invite = await InviteModel.findOne({ tokenHash: hashToken(rawToken) })
    if (!invite) throw new HttpError(404, 'Invalid invite')
    if (invite.expiresAt.getTime() <= Date.now()) throw new HttpError(410, 'Invite expired')
    const user = await UserModel.findById(invite.userId)
    if (!user || user.role !== 'organizer') throw new HttpError(404, 'Invalid invite')

    const phone = canonicalizePhone(phoneRaw)
    const taken = await UserModel.exists({ phone, _id: { $ne: user._id } })
    if (taken) throw new HttpError(409, 'Phone already registered')

    user.phone = phone
    user.active = true
    await user.save()
    await InviteModel.deleteMany({ userId: user._id })

    const token = await sessionService.create(user._id, user.role, userAgent)
    return { token, user: toPublicUser(user) }
  },
}
```

- [ ] **Step 4: Typecheck.** Run: `npm run typecheck` — Expected: PASS. (If it errors on `PublicUser`/`toPublicUser` import, confirm both are exported from `services/auth.services.ts` — they are as of 2026-07-12.)

- [ ] **Step 5: Commit** (with permission).

```bash
npx prettier --write --end-of-line auto src/models/user.model.ts src/models/invite.model.ts src/services/invite.services.ts
git add src/models/user.model.ts src/models/invite.model.ts src/services/invite.services.ts
git commit -m "feat(invite): add email field, Invite model, invite service"
```

---

## Task 3: change organizer create + resend/revoke

**Files:**
- Modify: `src/validators/organizer.validators.ts`
- Modify: `src/services/organizer.services.ts`
- Modify: `src/controllers/organizer.controllers.ts`
- Modify: `src/routes/organizer.routes.ts`

**Interfaces:**
- Consumes: `inviteService.createInvite`, `mailer.sendOrganizerInvite`, `env.APP_URL`, `env.NODE_ENV`.
- Produces: `PublicOrganizer` = `{ id, email: string|null, phone: string|null, name, surname, status: 'pending'|'active'|'deactivated', createdAt }`; `organizerService.create(input): Promise<{ organizer: PublicOrganizer; inviteUrl?: string }>`, `resendInvite(id)`, `revokeInvite(id)`.

- [ ] **Step 1: Update the create validator.** Replace the `createOrganizerSchema` in `src/validators/organizer.validators.ts` (keep `phone` const for reuse elsewhere is unnecessary — remove if now unused to satisfy `noUnusedLocals`):

```ts
export const createOrganizerSchema = z.object({
  name: z.string().min(1).max(60),
  surname: z.string().min(1).max(60),
  email: z.string().email('A valid email is required'),
})
```

Note: if removing `phone` leaves it unused, delete the `const phone = …` line too (TS `noUnusedLocals`). `updateOrganizerSchema` and `organizerIdParam` stay.

- [ ] **Step 2: Rewrite the organizer service.** Replace the body of `src/services/organizer.services.ts` with (drops bcrypt/password, adds email+status+invite):

```ts
import type { HydratedDocument } from 'mongoose'
import { UserModel, type User } from '../models/user.model'
import { InviteModel } from '../models/invite.model'
import { HttpError } from '../middlewares/error.middleware'
import { sessionService } from './session.services'
import { inviteService } from './invite.services'
import { mailer } from './mailer.service'
import { env } from '../config/env'
import type { CreateOrganizerInput } from '../validators/organizer.validators'

export type OrganizerStatus = 'pending' | 'active' | 'deactivated'

export type PublicOrganizer = {
  id: string
  email: string | null
  phone: string | null
  name: string
  surname: string
  status: OrganizerStatus
  createdAt: string
}

function statusOf(user: HydratedDocument<User>): OrganizerStatus {
  if (!user.phone) return 'pending' // invited, not yet accepted
  return user.active ? 'active' : 'deactivated'
}

function toPublicOrganizer(user: HydratedDocument<User>): PublicOrganizer {
  return {
    id: String(user._id),
    email: user.email ?? null,
    phone: user.phone ?? null,
    name: user.name,
    surname: user.surname,
    status: statusOf(user),
    createdAt: (user as unknown as { createdAt: Date }).createdAt.toISOString(),
  }
}

export const organizerService = {
  list: async (): Promise<PublicOrganizer[]> => {
    const users = await UserModel.find({ role: 'organizer' }).sort({ createdAt: -1 })
    return users.map(toPublicOrganizer)
  },

  /** Create a PENDING organizer (email only) and email them an invite link. */
  create: async (
    input: CreateOrganizerInput,
  ): Promise<{ organizer: PublicOrganizer; inviteUrl?: string }> => {
    const email = input.email.toLowerCase()
    const exists = await UserModel.exists({ email })
    if (exists) throw new HttpError(409, 'Email already registered')

    const user = await UserModel.create({
      email,
      name: input.name,
      surname: input.surname,
      role: 'organizer',
      active: true, // active flag ≠ accepted; status is 'pending' until phone is set
    })

    const rawToken = await inviteService.createInvite(user._id, email)
    const inviteUrl = `${env.APP_URL}/invite/${rawToken}`
    await mailer.sendOrganizerInvite({ to: email, name: user.name, link: inviteUrl })

    // Expose the link in dev only, so the org can test without a real inbox.
    return {
      organizer: toPublicOrganizer(user),
      ...(env.NODE_ENV !== 'production' ? { inviteUrl } : {}),
    }
  },

  /** Re-issue + resend an invite. Pending organizers only. */
  resendInvite: async (id: string): Promise<{ organizer: PublicOrganizer; inviteUrl?: string }> => {
    const user = await UserModel.findOne({ _id: id, role: 'organizer' })
    if (!user) throw new HttpError(404, 'Organizer not found')
    if (user.phone) throw new HttpError(409, 'Organizer already active')
    const email = user.email ?? ''
    const rawToken = await inviteService.createInvite(user._id, email)
    const inviteUrl = `${env.APP_URL}/invite/${rawToken}`
    await mailer.sendOrganizerInvite({ to: email, name: user.name, link: inviteUrl })
    return {
      organizer: toPublicOrganizer(user),
      ...(env.NODE_ENV !== 'production' ? { inviteUrl } : {}),
    }
  },

  /** Revoke a PENDING invite: delete the stub user + token. Pending only. */
  revokeInvite: async (id: string): Promise<void> => {
    const user = await UserModel.findOne({ _id: id, role: 'organizer' })
    if (!user) throw new HttpError(404, 'Organizer not found')
    if (user.phone) throw new HttpError(409, 'Organizer already active — deactivate instead')
    await InviteModel.deleteMany({ userId: user._id })
    await UserModel.deleteOne({ _id: user._id })
  },

  setActive: async (id: string, active: boolean): Promise<PublicOrganizer> => {
    const user = await UserModel.findOne({ _id: id, role: 'organizer' })
    if (!user) throw new HttpError(404, 'Organizer not found')
    user.active = active
    await user.save()
    if (!active) await sessionService.revokeAllForUser(user._id)
    return toPublicOrganizer(user)
  },
}
```

- [ ] **Step 3: Update the controllers.** In `src/controllers/organizer.controllers.ts`, replace `createOrganizer` and add `resendInvite` + `revokeInvite`:

```ts
export const createOrganizer: RequestHandler = async (req, res) => {
  const result = await organizerService.create(req.body)
  res.status(201).json(result) // { organizer, inviteUrl? }
}

export const resendInvite: RequestHandler = async (req, res) => {
  const result = await organizerService.resendInvite(String(req.params.id))
  res.json(result)
}

export const revokeInvite: RequestHandler = async (req, res) => {
  await organizerService.revokeInvite(String(req.params.id))
  res.status(204).end()
}
```

(`listOrganizers` and `updateOrganizer` stay unchanged.)

- [ ] **Step 4: Add the routes.** In `src/routes/organizer.routes.ts`, import the new handlers and add the routes (the whole router stays org-only via the top `router.use(requireAuth, requireRole('organization'))`):

```ts
import {
  listOrganizers,
  createOrganizer,
  updateOrganizer,
  resendInvite,
  revokeInvite,
} from '../controllers/organizer.controllers'
```

```ts
router.post('/:id/resend', validate({ params: organizerIdParam }), resendInvite)
router.delete('/:id', validate({ params: organizerIdParam }), revokeInvite)
```

- [ ] **Step 5: Typecheck.** Run: `npm run typecheck` — Expected: PASS.

- [ ] **Step 6: Commit** (with permission).

```bash
npx prettier --write --end-of-line auto src/validators/organizer.validators.ts src/services/organizer.services.ts src/controllers/organizer.controllers.ts src/routes/organizer.routes.ts
git add src/validators/organizer.validators.ts src/services/organizer.services.ts src/controllers/organizer.controllers.ts src/routes/organizer.routes.ts
git commit -m "feat(organizer): email invite create + resend/revoke, derived status"
```

---

## Task 4: public invite routes + openapi + backend verification

**Files:**
- Create: `src/validators/invite.validators.ts`
- Create: `src/controllers/invite.controllers.ts`
- Create: `src/routes/invite.routes.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/docs/openapi.ts`

**Interfaces:**
- Consumes: `inviteService.getPublicInvite`, `inviteService.accept`; cookie helpers from `config/cookies`.
- Produces: `GET /api/invite/:token`, `POST /api/invite/:token/accept`.

- [ ] **Step 1: Validators** `src/validators/invite.validators.ts`:

```ts
import { z } from '../config/zod'

// 9 national digits — matches the frontend PHONE_LENGTH and auth.validators.
const phone = z.string().regex(/^\d{9}$/, 'Phone must be 9 digits')

export const acceptInviteSchema = z.object({ phone })

export const inviteTokenParam = z.object({
  token: z.string().min(20, 'Invalid token'),
})

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>
```

- [ ] **Step 2: Controllers** `src/controllers/invite.controllers.ts` (accept sets the session cookie, mirroring `auth.controllers.login`):

```ts
import type { RequestHandler } from 'express'
import { inviteService } from '../services/invite.services'
import { SESSION_COOKIE_NAME, setCookieOptions } from '../config/cookies'

export const getInvite: RequestHandler = async (req, res) => {
  const invite = await inviteService.getPublicInvite(String(req.params.token))
  res.json(invite) // { name, email }
}

export const acceptInvite: RequestHandler = async (req, res) => {
  const { token, user } = await inviteService.accept(
    String(req.params.token),
    req.body.phone,
    req.get('user-agent'),
  )
  res.cookie(SESSION_COOKIE_NAME, token, setCookieOptions())
  res.json({ user })
}
```

- [ ] **Step 3: Routes** `src/routes/invite.routes.ts` (PUBLIC — no requireAuth):

```ts
import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { acceptInviteSchema, inviteTokenParam } from '../validators/invite.validators'
import { getInvite, acceptInvite } from '../controllers/invite.controllers'

// Public, token-gated: an invited organizer completes onboarding here without an
// existing session. Authorization is the unguessable token, not a role.
const router = Router()

router.get('/:token', validate({ params: inviteTokenParam }), getInvite)
router.post(
  '/:token/accept',
  validate({ params: inviteTokenParam, body: acceptInviteSchema }),
  acceptInvite,
)

export default router
```

- [ ] **Step 4: Mount it.** In `src/routes/index.ts`, add:

```ts
import inviteRoutes from './invite.routes'
```

```ts
router.use('/invite', inviteRoutes)
```

- [ ] **Step 5: Register in openapi.** In `src/docs/openapi.ts`, add (near the other `registerPath` calls; import `acceptInviteSchema` at the top if referencing it):

```ts
registry.registerPath({
  method: 'get',
  path: '/api/invite/{token}',
  tags: ['Invite'],
  summary: 'Public: fetch an organizer invite for the accept screen',
  responses: {
    200: {
      description: 'Invitee name + email',
      content: { 'application/json': { schema: z.object({ name: z.string(), email: z.string() }) } },
    },
    404: { description: 'Invalid invite' },
    410: { description: 'Invite expired' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/invite/{token}/accept',
  tags: ['Invite'],
  summary: 'Public: accept an invite by supplying a phone; starts a session',
  request: { body: { content: { 'application/json': { schema: acceptInviteSchema } } } },
  responses: {
    200: { description: 'Accepted; sets the camply_sid cookie' },
    409: { description: 'Phone already registered' },
  },
})
```

(Use `z` from `config/zod` as the file already does; import `acceptInviteSchema` from `../validators/invite.validators`.)

- [ ] **Step 6: Typecheck.** Run: `npm run typecheck` — Expected: PASS.

- [ ] **Step 7: Verify the whole backend flow (curl).** Start Mongo + `npm run dev`. Then:

```bash
cd /private/tmp/.../scratchpad   # any writable dir
JAR=cookies.txt; rm -f $JAR
# org login
curl -s -c $JAR -X POST http://localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"camply-dev-org-pass"}' -o /dev/null -w "login %{http_code}\n"
# create by email → capture inviteUrl
RESP=$(curl -s -b $JAR -X POST http://localhost:4000/api/organizers -H 'Content-Type: application/json' \
  -d '{"name":"Invy","surname":"Testov","email":"invy@example.com"}')
echo "$RESP"
TOKEN=$(echo "$RESP" | python3 -c "import sys,json,urllib.parse as u; print(json.load(sys.stdin)['inviteUrl'].rsplit('/',1)[1])")
# public get invite
curl -s http://localhost:4000/api/invite/$TOKEN -w "\nget %{http_code}\n"
# accept with a fresh phone → sets cookie
curl -s -c accept.txt -X POST http://localhost:4000/api/invite/$TOKEN/accept -H 'Content-Type: application/json' \
  -d '{"phone":"944445566"}' -w "\naccept %{http_code}\n"
# list shows it active with phone; second accept 404
curl -s -b $JAR http://localhost:4000/api/organizers
curl -s http://localhost:4000/api/invite/$TOKEN -w "\nreused %{http_code}\n"
```

Expected: login 200; create returns `{organizer:{status:"pending",email:...,phone:null}, inviteUrl}`; get 200 `{name,email}`; accept 200; list shows the organizer `status:"active"` with `+998944445566`; reused token → 404. Also confirm the backend console logged an **Ethereal preview URL** — open it to see the email. Test 409s: create the same email twice → 409; accept with an already-used phone → 409.

- [ ] **Step 8: Commit** (with permission).

```bash
cd /Users/macbookuz/Desktop/Camply/camply-backend
npx prettier --write --end-of-line auto src/validators/invite.validators.ts src/controllers/invite.controllers.ts src/routes/invite.routes.ts src/routes/index.ts src/docs/openapi.ts
npm run validate
git add src/validators/invite.validators.ts src/controllers/invite.controllers.ts src/routes/invite.routes.ts src/routes/index.ts src/docs/openapi.ts
git commit -m "feat(invite): public get + accept routes, openapi, mount"
```

---

# FRONTEND

## Task 5: i18n — invite + status strings (UZ/RU/EN)

**Files:**
- Modify: `src/i18n/translations.ts` (`AdminStrings` type ~line 443; UZ/RU/EN blocks; a new top-level `InviteStrings` tree)

**Interfaces:**
- Produces: `t.admin.create.email/sent`, `t.admin.organizers.{pending,resend,revoke,confirmRevoke}`, `t.admin.dashboard.stats.pending`, and a new `t.invite.*` tree. Consumed by Tasks 6–8.

- [ ] **Step 1: Extend the `AdminStrings` type.** In `src/i18n/translations.ts`, add keys to the existing sub-objects:
  - In `create`: add `email: string` and `sent: string // 'Invitation sent to {email}'` and `copyLink: string`.
  - In `organizers`: add `pending: string`, `resend: string`, `revoke: string`, `confirmRevoke: string`.
  - In `dashboard.stats`: add `pending: string`.

- [ ] **Step 2: Add an `InviteStrings` type** near the other string types (e.g. after `AdminStrings`):

```ts
type InviteStrings = {
  title: string // 'Welcome, {name}'
  subtitle: string
  phoneLabel: string
  submit: string
  loading: string
  invalid: string
  expired: string
  loadError: string
}
```

And add `invite: InviteStrings` to the per-language object type in the `translations` `Record` (alongside `admin: AdminStrings`).

- [ ] **Step 3: Fill UZ** — in the UZ block, add the new admin keys and the `invite` tree. Add to `create`:

```ts
        email: 'Email',
        sent: '{email} manziliga taklifnoma yuborildi',
        copyLink: 'Havoladan nusxa olish',
```

Add to `organizers`:

```ts
        pending: 'Kutilmoqda',
        resend: 'Qayta yuborish',
        revoke: 'Bekor qilish',
        confirmRevoke: 'Bu taklifnoma bekor qilinsinmi?',
```

Add to `dashboard.stats`: `pending: 'Kutilmoqda',`

Add a top-level `invite` (sibling of `admin`, `login`, etc.):

```ts
    invite: {
      title: 'Xush kelibsiz, {name}',
      subtitle: 'Tashkilotchi sifatida kirish uchun telefon raqamingizni kiriting.',
      phoneLabel: 'Telefon raqam',
      submit: 'Kirish',
      loading: 'Yuklanmoqda…',
      invalid: 'Taklifnoma yaroqsiz.',
      expired: 'Taklifnoma muddati tugagan.',
      loadError: 'Taklifnomani yuklab boʻlmadi.',
    },
```

- [ ] **Step 4: Fill RU** — same keys, Russian:

`create`: `email: 'Email'`, `sent: 'Приглашение отправлено на {email}'`, `copyLink: 'Скопировать ссылку'`.
`organizers`: `pending: 'Ожидает'`, `resend: 'Отправить снова'`, `revoke: 'Отменить'`, `confirmRevoke: 'Отменить это приглашение?'`.
`dashboard.stats`: `pending: 'Ожидают'`.

```ts
    invite: {
      title: 'Добро пожаловать, {name}',
      subtitle: 'Введите номер телефона, чтобы войти как организатор.',
      phoneLabel: 'Номер телефона',
      submit: 'Войти',
      loading: 'Загрузка…',
      invalid: 'Приглашение недействительно.',
      expired: 'Срок приглашения истёк.',
      loadError: 'Не удалось загрузить приглашение.',
    },
```

- [ ] **Step 5: Fill EN** — same keys, English:

`create`: `email: 'Email'`, `sent: 'Invitation sent to {email}'`, `copyLink: 'Copy link'`.
`organizers`: `pending: 'Pending'`, `resend: 'Resend'`, `revoke: 'Revoke'`, `confirmRevoke: 'Revoke this invitation?'`.
`dashboard.stats`: `pending: 'Pending'`.

```ts
    invite: {
      title: 'Welcome, {name}',
      subtitle: 'Enter your phone number to join as an organizer.',
      phoneLabel: 'Phone number',
      submit: 'Enter',
      loading: 'Loading…',
      invalid: 'This invitation is invalid.',
      expired: 'This invitation has expired.',
      loadError: "Couldn't load the invitation.",
    },
```

- [ ] **Step 6: Typecheck.** Run: `npm run typecheck` — Expected: PASS (the type forces all three languages + `invite` on every locale).

- [ ] **Step 7: Commit** (with permission).

```bash
npx prettier --write --end-of-line auto src/i18n/translations.ts
git add src/i18n/translations.ts
git commit -m "i18n: add invite onboarding + organizer status strings (UZ/RU/EN)"
```

---

## Task 6: frontend data layer (organizers changes + invites service)

**Files:**
- Modify: `src/api/queryKeys.ts`
- Modify: `src/api/services/organizers.service.ts`
- Modify: `src/api/queries/organizers.queries.ts`
- Create: `src/api/services/invites.service.ts`
- Create: `src/api/queries/invites.queries.ts`

**Interfaces:**
- Produces: updated `Organizer` type (`email`, `status`) + `CreateOrganizerBody` (`{name,surname,email}`); `useResendInvite`, `useRevokeInvite`; `invitesService.get/accept`, `useInvite`, `useAcceptInvite`. Consumed by Tasks 7–8.

- [ ] **Step 1: Add an invite query key.** In `src/api/queryKeys.ts`, add:

```ts
/** A single public organizer invite (accept page), keyed by its token. */
export const inviteKeys = {
  detail: (token: string) => ['invite', token] as const,
}
```

- [ ] **Step 2: Update the organizers service.** In `src/api/services/organizers.service.ts`, change the `Organizer` type, the create body/return, and add resend/revoke:

```ts
export type OrganizerStatus = 'pending' | 'active' | 'deactivated'

export type Organizer = {
  id: string
  email: string | null
  phone: string | null
  name: string
  surname: string
  status: OrganizerStatus
  createdAt: string
}

/** Create-by-email: the organizer completes onboarding via an emailed link. */
export type CreateOrganizerBody = {
  name: string
  surname: string
  email: string
}

export const organizersService = {
  list: async (): Promise<Organizer[]> => {
    const res = await axiosInstance.get<{ organizers: Organizer[] }>('/organizers')
    return res.data.organizers
  },
  create: async (
    body: CreateOrganizerBody,
  ): Promise<{ organizer: Organizer; inviteUrl?: string }> => {
    const res = await axiosInstance.post<{ organizer: Organizer; inviteUrl?: string }>(
      '/organizers',
      body,
    )
    return res.data
  },
  resendInvite: async (id: string): Promise<{ organizer: Organizer; inviteUrl?: string }> => {
    const res = await axiosInstance.post<{ organizer: Organizer; inviteUrl?: string }>(
      `/organizers/${id}/resend`,
    )
    return res.data
  },
  revokeInvite: async (id: string): Promise<void> => {
    await axiosInstance.delete(`/organizers/${id}`)
  },
  setActive: async (id: string, active: boolean): Promise<Organizer> => {
    const res = await axiosInstance.patch<{ organizer: Organizer }>(`/organizers/${id}`, { active })
    return res.data.organizer
  },
}
```

- [ ] **Step 3: Add resend/revoke query hooks.** In `src/api/queries/organizers.queries.ts`, keep `useOrganizers`/`useCreateOrganizer`/`useSetOrganizerActive` and add:

```ts
export function useResendInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => organizersService.resendInvite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminOrganizerKeys.all }),
  })
}

export function useRevokeInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => organizersService.revokeInvite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminOrganizerKeys.all }),
  })
}
```

(Note: `useCreateOrganizer`'s `mutationFn` return type widened to `{organizer, inviteUrl?}` automatically — the sheet reads `inviteUrl` from the result.)

- [ ] **Step 4: Create the invites service** `src/api/services/invites.service.ts`:

```ts
import { axiosInstance } from '../axiosInstance'
import type { AuthUser } from '../../store/useAuthStore'

/*
  The PUBLIC invite boundary — an invited organizer fetches their invite and accepts
  it by supplying a phone (no existing session; the token is the authorization).
  accept() returns the now-authenticated user (the backend set the session cookie),
  unwrapping { user } exactly like authService.login does.
*/
export type PublicInvite = { name: string; email: string }

export const invitesService = {
  get: async (token: string): Promise<PublicInvite> => {
    const res = await axiosInstance.get<PublicInvite>(`/invite/${token}`)
    return res.data
  },
  accept: async (token: string, phone: string): Promise<AuthUser> => {
    const res = await axiosInstance.post<{ user: AuthUser }>(`/invite/${token}/accept`, { phone })
    return res.data.user
  },
}
```

(`AuthUser` is the frontend user type — exported from `src/store/useAuthStore.ts` and the same type `authService.login` returns. The accept response shape `{ user }` matches `/auth/login`.)

- [ ] **Step 5: Create the invites queries** `src/api/queries/invites.queries.ts`:

```ts
import { useMutation, useQuery } from '@tanstack/react-query'
import { invitesService } from '../services/invites.service'
import { inviteKeys } from '../queryKeys'
import { useAuthStore } from '../../store/useAuthStore'

/** Public invite lookup for the accept screen. Retries off — a 404/410 is terminal. */
export function useInvite(token: string) {
  return useQuery({
    queryKey: inviteKeys.detail(token),
    queryFn: () => invitesService.get(token),
    enabled: Boolean(token),
    retry: false,
  })
}

/** Accept the invite; on success the backend set the cookie — commit the identity. */
export function useAcceptInvite(token: string) {
  const setUser = useAuthStore((s) => s.setUser)
  return useMutation({
    mutationFn: (phone: string) => invitesService.accept(token, phone),
    onSuccess: (user) => setUser(user),
  })
}
```

(`useAuthStore` exposes `setUser(user: AuthUser)` — the same setter `useLogin`'s `onSuccess` uses via `setUser`. There is no `setSession`.)

- [ ] **Step 6: Typecheck.** Run: `npm run typecheck` — Expected: PASS. (Failures here will point at the `NewOrganizerSheet`/`OrganizerRow`/`DashboardScreen` still using old `Organizer` fields — those are fixed in Task 7, so a typecheck failure naming those files is expected until Task 7 lands. To keep this task independently green, you may do Steps 1–5 of Task 7 before re-running typecheck, or accept that the gate for this task is "the new files + service typecheck in isolation." Prefer sequencing Task 7 immediately after.)

- [ ] **Step 7: Commit** (with permission, after Task 7 if you bundle for a green typecheck).

```bash
npx prettier --write --end-of-line auto src/api/queryKeys.ts src/api/services/organizers.service.ts src/api/queries/organizers.queries.ts src/api/services/invites.service.ts src/api/queries/invites.queries.ts
git add src/api/queryKeys.ts src/api/services/organizers.service.ts src/api/queries/organizers.queries.ts src/api/services/invites.service.ts src/api/queries/invites.queries.ts
git commit -m "feat(admin): email-invite data layer + public invite service/queries"
```

---

## Task 7: create sheet (email) + row (status/resend/revoke) + dashboard stats

**Files:**
- Modify: `src/components/organization/organizers/NewOrganizerSheet.tsx`
- Modify: `src/components/organization/organizers/OrganizerRow.tsx`
- Modify: `src/components/organization/dashboard/DashboardScreen.tsx`

**Interfaces:**
- Consumes: updated `Organizer`/`OrganizerStatus`, `useCreateOrganizer`, `useResendInvite`, `useRevokeInvite`, `useSetOrganizerActive`, `t.admin.*`.

- [ ] **Step 1: Rewrite `NewOrganizerSheet`** to email-only. Replace its body:

```tsx
import { useState } from 'react'
import { useTranslation } from '../../../i18n/useTranslation'
import { interpolate } from '../../../lib/interpolate'
import { Button, Field, Sheet } from '../../ui'
import { ApiError } from '../../../api/axiosInstance'
import { useCreateOrganizer } from '../../../api/queries/organizers.queries'

/*
  Invite an organizer by email. On submit → useCreateOrganizer; the backend creates a
  PENDING organizer and emails a magic link. Success shows a confirmation (and, in
  dev, a copyable invite link the backend returns so you can test without an inbox).
  A 409 (email already registered) surfaces inline.
*/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function NewOrganizerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const create = useCreateOrganizer()

  const [name, setName] = useState('')
  const [surname, setSurname] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ email: string; inviteUrl?: string } | null>(null)

  const valid = name.trim().length > 0 && surname.trim().length > 0 && EMAIL_RE.test(email.trim())

  const reset = () => {
    setName('')
    setSurname('')
    setEmail('')
    setError(null)
    setSent(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = () => {
    if (!valid) return
    setError(null)
    create.mutate(
      { name: name.trim(), surname: surname.trim(), email: email.trim().toLowerCase() },
      {
        onSuccess: (res) => setSent({ email: email.trim().toLowerCase(), inviteUrl: res.inviteUrl }),
        onError: (err) =>
          setError(
            err instanceof ApiError && err.status === 409
              ? t.admin.create.duplicate
              : err instanceof Error
                ? err.message
                : t.admin.create.duplicate,
          ),
      },
    )
  }

  return (
    <Sheet open={open} onClose={close} closeLabel={t.notfound.back} title={t.admin.create.title}>
      {sent ? (
        <div className="flex flex-col gap-4 px-1 pb-2">
          <p className="text-body text-content">{interpolate(t.admin.create.sent, { email: sent.email })}</p>
          {sent.inviteUrl ? (
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(sent.inviteUrl!)}
              className="truncate rounded-input border border-line bg-surface px-3 py-2 text-left font-mono text-caption text-pine"
            >
              {t.admin.create.copyLink}: {sent.inviteUrl}
            </button>
          ) : null}
          <Button variant="primary" size="lg" fullWidth onClick={close}>
            {t.notfound.back}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-1 pb-2">
          <div>
            <label className="mb-1.5 block text-caption font-semibold text-muted">
              {t.admin.create.name}
            </label>
            <Field value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label className="mb-1.5 block text-caption font-semibold text-muted">
              {t.admin.create.surname}
            </label>
            <Field value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label className="mb-1.5 block text-caption font-semibold text-muted">
              {t.admin.create.email}
            </label>
            <Field
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>

          {error ? (
            <p role="alert" className="text-caption font-semibold text-danger">
              {error}
            </p>
          ) : null}

          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={!valid || create.isPending}
            onClick={submit}
          >
            {t.admin.create.submit}
          </Button>
        </div>
      )}
    </Sheet>
  )
}
```

- [ ] **Step 2: Update `OrganizerRow`** to status-driven display + actions. Replace its body:

```tsx
import { useTranslation } from '../../../i18n/useTranslation'
import { Badge } from '../../ui'
import {
  useSetOrganizerActive,
  useResendInvite,
  useRevokeInvite,
} from '../../../api/queries/organizers.queries'
import type { Organizer } from '../../../api/services/organizers.service'

/*
  One organizer row, driven by status:
   • pending     → shows email; actions Resend + Revoke (revoke deletes the invite)
   • active      → shows phone; action Deactivate (revokes their sessions server-side)
   • deactivated → shows phone; action Reactivate
*/
export function OrganizerRow({ organizer, last }: { organizer: Organizer; last: boolean }) {
  const { t } = useTranslation()
  const setActive = useSetOrganizerActive()
  const resend = useResendInvite()
  const revoke = useRevokeInvite()
  const busy = setActive.isPending || resend.isPending || revoke.isPending

  const toggle = () => {
    if (organizer.status === 'active' && !window.confirm(t.admin.organizers.confirmDeactivate)) return
    setActive.mutate({ id: organizer.id, active: organizer.status !== 'active' })
  }

  const onRevoke = () => {
    if (!window.confirm(t.admin.organizers.confirmRevoke)) return
    revoke.mutate(organizer.id)
  }

  const badge =
    organizer.status === 'pending'
      ? { tone: 'amber' as const, label: t.admin.organizers.pending }
      : organizer.status === 'active'
        ? { tone: 'pine' as const, label: t.admin.organizers.active }
        : { tone: 'muted' as const, label: t.admin.organizers.deactivated }

  const subtitle = organizer.status === 'pending' ? organizer.email : organizer.phone

  return (
    <div className={`flex items-center gap-3 py-3 ${last ? '' : 'border-b border-line'}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-title font-bold text-content">
          {organizer.name} {organizer.surname}
        </div>
        <div className="truncate font-mono text-caption text-muted">{subtitle ?? '—'}</div>
      </div>
      <Badge tone={badge.tone}>{badge.label}</Badge>
      {organizer.status === 'pending' ? (
        <div className="flex flex-none gap-2">
          <button
            type="button"
            onClick={() => resend.mutate(organizer.id)}
            disabled={busy}
            className="text-caption font-bold text-pine transition active:scale-95 disabled:opacity-50"
          >
            {t.admin.organizers.resend}
          </button>
          <button
            type="button"
            onClick={onRevoke}
            disabled={busy}
            className="text-caption font-bold text-danger transition active:scale-95 disabled:opacity-50"
          >
            {t.admin.organizers.revoke}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="flex-none text-caption font-bold text-pine transition active:scale-95 disabled:opacity-50"
        >
          {organizer.status === 'active'
            ? t.admin.organizers.deactivate
            : t.admin.organizers.reactivate}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Update Dashboard stats** to status-based. In `src/components/organization/dashboard/DashboardScreen.tsx`, replace the `activeCount`/`stats` derivation:

```tsx
  const list = organizers.data ?? []
  const activeCount = list.filter((o) => o.status === 'active').length
  const pendingCount = list.filter((o) => o.status === 'pending').length
  const stats = [
    { label: t.admin.dashboard.stats.organizers, value: list.length },
    { label: t.admin.dashboard.stats.active, value: activeCount },
    { label: t.admin.dashboard.stats.pending, value: pendingCount },
    { label: t.admin.dashboard.stats.camps, value: camps.data?.length ?? 0 },
  ]
```

(Drops the "deactivated" tile in favor of "pending" — keeps 4 tiles. `deactivated` string stays used by `OrganizerRow`.)

- [ ] **Step 4: Typecheck.** Run: `npm run typecheck` — Expected: PASS (this + Task 6 together make the frontend whole).

- [ ] **Step 5: Verify in the browser.** Backend running with the invite flow (Task 4). `npm run dev`, log in at `/admin/login`. Create an organizer by email → sheet shows "Invitation sent to …" + a copyable dev link → the Organizers list + Dashboard show a **Pending** row (amber, email) and the Pending tile increments. Resend works; Revoke (confirm) removes the row.

- [ ] **Step 6: Commit** (with permission).

```bash
npx prettier --write --end-of-line auto src/components/organization/organizers/NewOrganizerSheet.tsx src/components/organization/organizers/OrganizerRow.tsx src/components/organization/dashboard/DashboardScreen.tsx
git add src/components/organization/organizers/ src/components/organization/dashboard/DashboardScreen.tsx
git commit -m "feat(admin): email-invite create sheet, pending status row, dashboard stats"
```

---

## Task 8: public invite accept page + route + end-to-end verification

**Files:**
- Create: `src/components/invite/InviteAcceptScreen.tsx`
- Modify: `src/App.tsx` (public route)

**Interfaces:**
- Consumes: `useInvite`, `useAcceptInvite` (Task 6), `PhoneInput` + `PHONE_LENGTH`, `t.invite.*`.

- [ ] **Step 1: Create the accept screen** `src/components/invite/InviteAcceptScreen.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from '../../i18n/useTranslation'
import { interpolate } from '../../lib/interpolate'
import { Button } from '../ui'
import { PhoneInput } from '../auth/PhoneInput'
import { PHONE_LENGTH } from '../../lib/phone'
import { ApiError } from '../../api/axiosInstance'
import { useInvite, useAcceptInvite } from '../../api/queries/invites.queries'

/*
  Public organizer-invite accept page at /invite/:token. Validates the token, greets
  the invitee, and takes their phone to activate the account + start a session (the
  backend sets the cookie), then routes into /org. On-brand pine→deep backdrop.
*/
export function InviteAcceptScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const token = useParams().token ?? ''
  const invite = useInvite(token)
  const accept = useAcceptInvite(token)
  const [phone, setPhone] = useState('')

  const submit = () => {
    if (phone.length !== PHONE_LENGTH) return
    accept.mutate(phone, { onSuccess: () => navigate('/org', { replace: true }) })
  }

  const errorText =
    invite.error instanceof ApiError && invite.error.status === 410
      ? t.invite.expired
      : invite.isError
        ? t.invite.invalid
        : null

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-pine to-deep px-5">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-lg">
        {invite.isPending ? (
          <p className="text-body text-muted">{t.invite.loading}</p>
        ) : errorText ? (
          <p role="alert" className="text-title font-bold text-content">
            {errorText}
          </p>
        ) : (
          <>
            <h1 className="text-subhead font-bold text-content">
              {interpolate(t.invite.title, { name: invite.data!.name })}
            </h1>
            <p className="mb-5 mt-1 text-caption text-muted">{t.invite.subtitle}</p>

            <PhoneInput
              value={phone}
              onChange={setPhone}
              label={t.invite.phoneLabel}
              error={t.login.phoneError}
            />

            {accept.isError ? (
              <p role="alert" className="mt-3 text-caption font-semibold text-danger">
                {accept.error instanceof ApiError && accept.error.status === 409
                  ? t.login.phoneError
                  : t.invite.loadError}
              </p>
            ) : null}

            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="mt-5"
              disabled={phone.length !== PHONE_LENGTH || accept.isPending}
              onClick={submit}
            >
              {t.invite.submit}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the public route.** In `src/App.tsx`, import and add the route as a sibling of `/` and `/admin/login` (OUTSIDE any auth guard):

```tsx
import { InviteAcceptScreen } from './components/invite/InviteAcceptScreen'
```

```tsx
        <Route path="/invite/:token" element={<InviteAcceptScreen />} />
```

- [ ] **Step 3: Typecheck.** Run: `npm run typecheck` — Expected: PASS.

- [ ] **Step 4: Full end-to-end verification (headless Chrome, real backend).** With the backend (invite flow) + frontend running: log in as org → create an organizer by email → copy the dev invite link from the sheet → open `/invite/<token>` in the driver → the welcome renders with the name → enter a fresh 9-digit phone → submit → lands on `/org` authenticated. Back at `/admin/organizers`, the row is now **Active** with the phone; the Pending tile decremented. Also drive the error paths: a garbage token → "invalid"; (optionally) an expired one → "expired". Confirm dark mode + mobile render. Zero console errors.

- [ ] **Step 5: Final gate.** Run: `npm run validate` — Expected: lint + typecheck PASS (format:check may warn tree-wide per the CRLF caveat; confirm your touched files are clean with `npx prettier --check --end-of-line auto <files>`).

- [ ] **Step 6: Update docs.** In `camply-frontend/CLAUDE.md` (org surface / Navigation section) note the new **public** `/invite/:token` route and that organizer creation is now email-invite based. In `camply-backend/CLAUDE.md` (organizers domain paragraph) note the `email` field, the `Invite` model + mailer, the changed `POST /organizers` (email), `resend`/`DELETE`, and the public `/invite` routes.

- [ ] **Step 7: Commit** (with permission).

```bash
npx prettier --write --end-of-line auto src/components/invite/InviteAcceptScreen.tsx src/App.tsx
git add src/components/invite/ src/App.tsx ../camply-frontend/CLAUDE.md ../camply-backend/CLAUDE.md
git commit -m "feat(invite): public accept page + route; docs"
```

---

## Verification tooling (recipes a cold session needs)

The backend tasks verify with **curl**; the frontend tasks verify by **driving the real app in headless Chrome**. Both recipes below are proven working in this environment. Use your own session scratchpad dir for temp files (not `/tmp`).

### curl (backend flows)

Cookie-jar pattern — log in once as the org, reuse the jar for org-only calls:

```bash
cd <your-scratchpad>
JAR=cookies.txt; rm -f $JAR
curl -s -c $JAR -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"camply-dev-org-pass"}' -o /dev/null -w "login %{http_code}\n"
# then -b $JAR on subsequent org-only requests (GET/POST/DELETE /api/organizers ...)
```

Public invite endpoints need **no** cookie. To pull a token out of a create response, the `inviteUrl` is `${APP_URL}/invite/<token>` — split on the last `/`. Watch the **backend console** for the `✉️  Invite email preview:` Ethereal URL to view the actual email.

### Headless Chrome (frontend flows) — playwright-core driving the user's Chrome

No browser download: install `playwright-core` in the scratchpad and launch the installed Chrome via `channel: 'chrome'` (per the `camply-phone-preview` project memory).

```bash
cd <your-scratchpad> && npm init -y >/dev/null 2>&1 && npm install playwright-core >/dev/null 2>&1
```

Driving nuances (each one cost real time to discover):
- **Launch:** `chromium.launch({ channel: 'chrome' })` — uses `/Applications/Google Chrome.app`, no 150MB download.
- **Force English** so text selectors are stable: after the first `goto`, `localStorage.setItem('camply-lang', JSON.stringify({ state: { selectedLang: 'en' }, version: 0 }))`, then `reload`.
- **Org login form selectors:** username `input[autocomplete="username"]`, password `input[type="password"]`, submit `button[type="submit"]`. After submit, `page.waitForURL('**/admin/dashboard')`.
- **Type char-by-char** to exercise real keystrokes: `page.keyboard.type('...', { delay: 30 })` after clicking the field — this is what surfaced the Sheet focus bug; `page.fill` sets the value in one shot and would hide such bugs.
- **Sheet inputs** (create): scope to `div[role="dialog"]`; name/surname are `input[autocomplete="off"]`, the Create button is `getByRole('button', { name: /create organizer/i })`.
- **PWA toast** ("ready to work offline" / "Camply oflayn ishlashga tayyor") can cover the bottom of the screen on a fresh service worker — remove any `position:fixed` element matching `/offline|oflayn|офлайн|ready to work/i` before screenshotting.
- **Mobile viewport:** `{ width: 430, height: 932 }` shows the bottom nav; desktop `1280×900` shows the sidebar.
- **Dark mode:** `document.documentElement.classList.add('dark')` (class-based, not OS).
- **Capture console errors:** subscribe to `page.on('console'...)` + `page.on('pageerror'...)` and assert zero — a clean run should log **none**.
- **The invite accept page** is at `/invite/:token` (public, no login). To test it in the same driver, create an organizer via the sheet, read the dev `inviteUrl` from the success view, then `goto` it in a fresh context (no org cookie) to simulate the organizer.

### Shell gotcha (this environment uses zsh)

zsh does **not** word-split unquoted variables, so `npx prettier --write $FILES` treats the whole list as one pattern and fails with "No files matching." **List files literally** on the prettier/git command, or use a `zsh` array. (bash-style `$FILES` splitting won't happen here.)

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §4.1 user email → T2. §4.2 Invite model → T2. §4.3 mailer → T1. §4.4 env → T1.
  §4.5 organizer service (create/resend/revoke/status) → T3. §4.6 invite service +
  accept → T2/T4. §4.7 routes/validators/openapi → T3/T4. ✅
- §5.1 FE data layer → T6. §5.2 create sheet → T7. §5.3 row → T7. §5.4 accept page → T8.
  §5.5 dashboard stats → T7. §5.6 i18n → T5. ✅
- §7 verification → backend T4-Step7, frontend T7-Step5 + T8-Step4. ✅

**Placeholder scan:** every code step shows complete code; commands have expected output. The frontend name/path references were verified against the code and pinned to concrete values: `ApiError` from `../../../api/axiosInstance`, the user type `AuthUser` from `store/useAuthStore`, and the store setter `setUser` (no `setSession`). No placeholders. ✅

**Type consistency:** `PublicOrganizer`/`Organizer` share `{email, phone, name, surname, status, createdAt}`; `OrganizerStatus` = `'pending'|'active'|'deactivated'` used identically back+front; `statusOf` covers all cases; create returns `{organizer, inviteUrl?}` in service (T3), controller (T3), FE service (T6), and sheet (T7) consistently; `inviteService.accept` returns `{token, user}` consumed by `acceptInvite` controller (T4). `t.invite.*` and new `t.admin.*` keys defined in T5 before use in T7/T8. ✅

**Sequencing note:** Tasks 6 and 7 are type-coupled (the new `Organizer` shape in T6 makes T7's components necessary for a green frontend typecheck). Implement T6 then T7 back-to-back; treat their combined typecheck as the gate. Backend (T1–T4) is independently green at each task.
