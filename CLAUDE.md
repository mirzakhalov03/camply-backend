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

## Known gotcha — stale Mongo indexes

Mongoose does **not** drop indexes you stop declaring. If you remove a `unique`
field from a schema, its old index lingers in any DB that already ran the previous
schema and can cause spurious `E11000 duplicate key` errors. Drop it manually in
that DB: `db.collection.dropIndex('field_1')`. (A fresh DB is never affected.)

## Keep this file current

Update it in the same change whenever you alter architecture, conventions,
commands, or a cross-cutting pattern (a new middleware, a new layer rule).
