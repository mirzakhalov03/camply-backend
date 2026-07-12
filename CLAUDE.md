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
  `SEED_ORG_USERNAME` / `SEED_ORG_PASSWORD` (dev defaults `admin` / `1234`). The
  org is keyed by **username** and has no phone.

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
- **Login identity:** participants/organizers log in by **phone**; the organization
  logs in by **username** (`User.username`, sparse-unique, lowercased — the org has
  no phone, which is now optional on the model). `loginSchema` is a union of the two
  shapes; `authService.login` branches on which is present.
- **`active` flag + deactivation:** every user has `User.active` (default true).
  Both `authService.login` and `requireAuth` reject `active === false` (401), so a
  deactivated organizer can't sign in **or** ride an existing session. Deactivating
  also calls `sessionService.revokeAllForUser` to kill live sessions immediately.
- **`organizers` domain** (`routes/services/controllers/validators/organizer.*`),
  org-only, extracted out of `auth.*`. Organizers are now onboarded by **emailed
  magic link**, not created fully-formed: `POST /organizers` takes `{name, surname,
  email}`, creates a **pending** organizer (no phone, no password), issues an
  `Invite` token, and emails a link (returns `inviteUrl` in dev). `POST
  /organizers/:id/resend` re-issues the token; `DELETE /organizers/:id` revokes a
  pending invite (deletes the stub user). `PATCH /organizers/:id` (`{ active }`)
  deactivates/reactivates an *accepted* organizer. Status is **derived** in
  `toPublicOrganizer` (`phone == null` → `pending`, else `active`/`deactivated`), not
  stored. The old password-based `create` is gone (organizers log in by phone).
- **Invite onboarding** (`models/invite.model.ts`, `services/invite.services.ts`,
  `services/mailer.service.ts`, public `routes/invite.routes.ts`). The `Invite` model
  mirrors `session.model.ts` (sha256 of the token, TTL index, single-use). Public,
  token-gated (no `requireAuth`): `GET /invite/:token` → `{name, email}` for the
  accept screen; `POST /invite/:token/accept` `{phone}` binds the phone, activates the
  user, deletes the invite, and **starts a session** (sets `camply_sid`) — same shape
  as login. Mailer uses nodemailer: real SMTP if `SMTP_*` env is set, else a dev
  **Ethereal** test account (preview URL logged, no real delivery). `User` gained a
  sparse-unique `email` field.
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

## Known gotcha — stale Mongo indexes

Mongoose does **not** drop indexes you stop declaring, nor **alter** an index whose
options changed. If you remove a `unique` field — or add `sparse` to an existing
unique index — the old index lingers in any DB that already ran the previous schema
and can cause spurious `E11000 duplicate key` errors. Drop it manually in that DB:
`db.collection.dropIndex('field_1')` (then let Mongoose rebuild it, or recreate it
with the right options). (A fresh DB is never affected.)

> **Hit in practice (2026-07-12):** `phone_1` existed as `unique` but **not
> `sparse`** in the dev DB (built before `phone` became optional). Creating a
> phone-less *pending* organizer collided with the org's `null` phone
> (`E11000 … phone: null`). Fix was `db.users.dropIndex('phone_1')` +
> `createIndex({phone:1},{unique:true,sparse:true})`. The schema was already correct.

## Keep this file current

Update it in the same change whenever you alter architecture, conventions,
commands, or a cross-cutting pattern (a new middleware, a new layer rule).
