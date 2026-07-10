# Camply — Authentication & Authorization Design

> **Status:** Approved design (2026-07-11). Next step: implementation plan.
> **Scope:** Backend auth for `camply-backend`, plus the small frontend deltas
> needed to match the cookie model. Membership (≤2 camps), invite codes, and
> camp lifecycle are **separate features** — this spec only identifies *who* a
> request is and *what role* they hold.

---

## 1. Goals & non-goals

**Goals**

- A stable, long-term authentication + authorization system built on
  **server-side sessions carried by an httpOnly cookie**.
- Participants **register and log in with only a phone number** (no secret yet),
  matching the current onboarding flow — with a clean seam to add OTP later.
- Organization and organizer accounts log in securely with **phone + password**.
- Authorization enforced **server-side on every protected route**, honoring the
  hierarchy `organization > organizer > participant`.
- Instant session revocation and **"log out everywhere"** (ReadyProduct §1).

**Non-goals (explicitly out of scope for this spec)**

- OTP / SMS verification (designed-for, not built).
- Self-service password reset via SMS/email (reset is admin-initiated for now).
- Camp membership, the ≤2-camp rule, invite codes, camp lifecycle.
- Granular sub-role permissions (`Context.md` §7 marks these post-launch).
- Frontend UI work beyond the mechanical session-plumbing deltas in §9.

---

## 2. Decisions (settled during brainstorming)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **httpOnly cookie session**, not a bearer token in localStorage | JS cannot read the credential → XSS can't steal it. Standard for a public PWA handling minors' location/SOS. |
| D2 | **Server-side sessions in MongoDB** (opaque cookie → `sessions` doc) | Instant revocation, "logout everywhere", visible devices. Cookie carries nothing sensitive. |
| D3 | **Participant phone-only now**, org/organizer **phone + password** now | Matches the onboarding flow; satisfies ReadyProduct §1's "secure login for org/organizers". |
| D4 | `/register` **pins role to `participant`** server-side, ignoring any client-sent role | Guardrail: only devs make orgs; organizers can't mint organizers. Never trust a client role. |
| D5 | Org/organizer creation via an **authorized admin path**; password reset is **tier-above-initiated** | Makes the hierarchy real & testable end-to-end without an unbuilt SMS/email system. |

---

## 3. Architecture overview

```
  Browser (PWA)                     camply-backend (Express 5)
  ────────────                      ──────────────────────────
  cookie: camply_sid  ──request──▶  cookie-parser
   (opaque, httpOnly)               requireAuth  ── hash sid ──▶ sessions coll (Mongo)
                                        │                          │ live? not expired?
                                        ▼                          ▼
                                    req.auth = { user, session }  load User
                                        │
                                    requireRole(min)  ── rank check ──▶ 403 or next
                                        │
                                    controller → service → model
```

Auth is **two composable middlewares**: `requireAuth` (authentication — "who are
you?") then `requireRole` (authorization — "what may you do?"). Every protected
route composes them. A hidden button is never a permission; the server is the
sole authority.

---

## 4. Data model

### 4.1 `User` (expand the existing placeholder in `models/user.model.ts`)

| Field | Type | Notes |
|-------|------|-------|
| `phone` | string | **Canonical E.164** `+998XXXXXXXXX`. `unique`, indexed. Input is 9 national digits; canonicalized before save/lookup. |
| `name` | string | required, trimmed |
| `surname` | string | required, trimmed |
| `role` | enum | `'participant' \| 'organizer' \| 'organization'`, default `'participant'` |
| `cityId` | string | participant profile (FE sends it) |
| `age` | number | participant profile |
| `photo` | string \| null | optional avatar (url/data URI) |
| `passwordHash` | string \| undefined | **only** org/organizer; participants have none |
| `createdAt / updatedAt` | date | `timestamps: true` |

- The current `email` field is replaced by `phone` as the identity key.
- `passwordHash` is **never** selected into API responses.

### 4.2 `Session` (new `models/session.model.ts`)

| Field | Type | Notes |
|-------|------|-------|
| `tokenHash` | string | **sha256 of the raw cookie value**. `unique`, indexed. The raw token exists only in the cookie. |
| `userId` | ObjectId → User | indexed |
| `role` | enum | snapshot of the user's role at creation |
| `expiresAt` | date | **TTL index** (`expireAfterSeconds: 0`) → Mongo auto-deletes expired docs |
| `lastSeenAt` | date | updated on sliding refresh |
| `userAgent` | string | for the "active devices" view |
| `createdAt` | date | `timestamps` |

---

## 5. Session & cookie mechanics

- **Cookie:** name `camply_sid`; value = 256-bit random, base64url-encoded.
- **Attributes:** `HttpOnly; SameSite=Lax; Path=/`; `Secure` added when
  `NODE_ENV === 'production'`. `SameSite=Lax` fits a same-site PWA and still
  allows top-level navigation.
- **Storage split:** the browser holds the raw token; the DB holds only its
  sha256. Lookup hashes the incoming cookie and matches `tokenHash`.
- **Sliding expiry:** on each authenticated request, if `lastSeenAt` is older
  than a refresh threshold, bump `lastSeenAt` and extend `expiresAt`. This is the
  "token expiry/refresh" of ReadyProduct §1 — no separate refresh token is needed
  with server-side sessions.
- **Config (add to `config/env.ts`, Zod-validated):**
  - `SESSION_TTL_DAYS` (default 30) — absolute lifetime / cookie Max-Age.
  - `SESSION_REFRESH_THRESHOLD_HOURS` (default 24) — how stale before a slide.
  - No signing secret: opaque tokens aren't signed; the DB is the source of truth.
- **Cookie options live in one place:** `config/cookies.ts` exports the option
  object so set/clear stay consistent.

---

## 6. Endpoints (all under `/api/auth`, plus one admin route)

| Method | Path | Guard | Body | Behavior |
|--------|------|-------|------|----------|
| POST | `/auth/register` | public + rate-limit | `{ phone, name, surname, cityId, age, photo? }` | Canonicalize phone; 409 if taken; create **participant** (role forced); create session; set cookie; return `{ user }`. |
| POST | `/auth/login` | public + rate-limit | `{ phone }` or `{ phone, password }` | Participant (no `passwordHash`): phone match → session. Org/organizer: verify `password` against `passwordHash` → session. Invalid → 401. Set cookie; return `{ user }`. |
| POST | `/auth/logout` | `requireAuth` | — | Delete this session; clear cookie; 204. |
| POST | `/auth/logout-all` | `requireAuth` | — | Delete **all** sessions for the user; clear cookie; 204. |
| GET | `/auth/me` | `requireAuth` | — | Return `{ id, phone, name, surname, role }`. |
| POST | `/organizers` | `requireAuth` + `requireRole('organization')` | `{ phone, name, surname, password }` | Create an `organizer` with a hashed password. Org-only. |

**Provisioning the first organization:** a **dev-only seed script**
(`npm run seed:org`) creates the initial `organization` account from env-supplied
phone + password. There is **no public path** to become an organization (guardrail).

**Password reset (v1):** tier-above-initiated. The organization can reset an
organizer's password (re-issues a temp password / sets a new hash); the dev
reseeds the organization. Self-service OTP reset is the documented later seam.

### Response shapes (the frontend data contract)

```ts
// success — login / register
200 { user: { id, phone, name, surname, role } }   // + Set-Cookie: camply_sid=...
// GET /me
200 { id, phone, name, surname, role }
// errors (existing envelope from error.middleware)
4xx { message, errors? }
```

---

## 7. Authorization

`middlewares/auth.middleware.ts` exports two composable handlers:

- **`requireAuth`** — read `camply_sid`; sha256 it; find a session where
  `tokenHash` matches and `expiresAt > now`; load the `User`; attach
  `req.auth = { user, session }`; run sliding refresh. Missing/invalid/expired →
  `HttpError(401)`.
- **`requireRole(min)`** — rank map `participant: 1, organizer: 2, organization: 3`;
  require `req.auth.user` rank `>= min`; else `HttpError(403)`.

Typing: extend Express's `Request` with an optional `auth` field via a
declaration-merge (`types/express.d.ts`) so `req.auth` is typed everywhere.

---

## 8. Security posture

Phone-only participant login means **anyone who knows a phone number can sign in
as that person** — no secret. Acceptable only as a temporary state; the design
contains the blast radius and leaves a clean upgrade path:

- **Rate limiting** (`express-rate-limit`) on `/login` and `/register`, keyed by
  IP and by phone, to blunt enumeration / impersonation.
- **OTP seam:** `/login` and `/register` are shaped so a `verifyOtp` second stage
  drops in without changing `/me`, sessions, or authorization.
- **Passwords** (org/organizer) hashed with **`bcryptjs`** — pure JS, no native
  build step. `passwordHash` never leaves the server.
- **Zod validation** on every input (phone shape, name lengths, age range);
  phone canonicalized to E.164 before any uniqueness check.
- Session token is high-entropy random and stored **hashed** (§4.2).

---

## 9. Frontend deltas (mechanical follow-up)

The cookie model requires small, precise changes — no UI redesign:

1. `api/axiosInstance.ts` — add `withCredentials: true`; **remove** the request
   interceptor that attaches `Authorization: Bearer`. Keep the 401 → `clear()`
   response interceptor.
2. `store/useAuthStore.ts` — keep `user`; **drop `token`** and every reference to
   it. `setSession` takes `{ user }`; `persist` keeps `user` only. (The cookie,
   not the store, is now the credential.)
3. `api/services/auth.service.ts` — `AuthSession` becomes `{ user }`;
   `login`/`register` return `{ user }`. `RegisterRequest` keeps its shape but the
   `role` field is ignored server-side (documented in a comment).
4. `api/queries/auth.queries.ts` — `onSuccess` commits `{ user }` (no token).

A logged-in session now survives reload because the **cookie** persists, not
because a token sits in localStorage.

---

## 10. New / changed files (following existing conventions)

```
NEW  src/models/session.model.ts
NEW  src/validators/auth.validators.ts
NEW  src/services/auth.services.ts          register / login / logout / logout-all / me
NEW  src/controllers/auth.controllers.ts    thin HTTP layer
NEW  src/middlewares/auth.middleware.ts     requireAuth, requireRole
NEW  src/routes/auth.routes.ts              mounted at /api/auth
NEW  src/config/cookies.ts                  single source of cookie options
NEW  src/types/express.d.ts                 req.auth declaration merge
NEW  src/scripts/seedOrg.ts                 dev-only first-organization seed
NEW  backend/CLAUDE.md                       fills the gap the root guide references

EDIT src/models/user.model.ts               phone/role/password/profile fields
EDIT src/config/env.ts                       SESSION_TTL_DAYS, refresh threshold, seed vars
EDIT src/app.ts                              cookie-parser middleware
EDIT src/routes/index.ts                     mount auth routes; add /organizers
EDIT src/docs/openapi.ts                     register auth paths & schemas
EDIT package.json                            deps + seed script

DEPS bcryptjs, cookie-parser, express-rate-limit  (+ @types/* as needed)
```

---

## 11. Testing & verification

The backend has no test runner and the frontend rule is "no tests." Auth is the
one place worth a **minimal backend-only** test setup (ReadyProduct §9 asks for
"tests cover critical paths (auth…)"). Treated as a **recommendation**, decided at
plan time — not forced. Minimum manual verification either way:

- Register a participant → cookie set → `GET /me` returns them.
- Login existing participant by phone; unknown phone → 401.
- Org login with correct/incorrect password → session / 401.
- `requireRole('organization')` blocks a participant/organizer with 403.
- `/register` with `role: 'organization'` in the body still creates a participant.
- `logout` kills this session; `logout-all` kills every session (second device's
  `/me` then 401s).
- Expired session (past `expiresAt`) → 401; TTL index removes the doc.

---

## 12. Open follow-ups (not this spec)

- OTP verification stage for participant register/login.
- Self-service password reset (needs SMS/email channel).
- Wiring membership (≤2 camps) and invite-code join on top of identity.
- Active-devices UI reading the `sessions` collection.
