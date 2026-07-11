# Organizer Invite-Based Onboarding — Design

**Date:** 2026-07-12
**Scope:** Cross-repo — `camply-backend` (auth/organizer domain, email) + `camply-frontend` (org admin surface + a new public invite page).
**Status:** Approved, ready for implementation plan.
**Related:** `2026-07-11-auth-authorization-design.md` (the auth/session/organizer foundation this builds on); `camply-frontend/docs/superpowers/specs/2026-07-12-organization-surface-prototype-design.md` (the org admin surface this modifies).

---

## 1. Context (read this first if you're picking this up cold)

Camply has three roles: **organization** (super-admin) → **organizer** → **participant**.
The organization super-admin creates organizers from the `/admin` surface.

**Today** (the starting state) an organizer is created fully-formed in one step: the org
submits `{name, surname, phone, password}` and `POST /organizers` creates an
`active` organizer with a bcrypt password. The org must know the organizer's phone
and invent a password for them.

**This change** replaces that with an **invitation + magic-link** flow:

```
Org fills {name, surname, email} → Create
   → backend creates a PENDING organizer (email set, phone null)
   → generates a one-time invite token, emails a link:  {APP_URL}/invite/<token>
Organizer opens the link
   → sees "Welcome {name}, enter your phone to join"
   → submits phone → account activated + session created (logged in) → lands in /org
```

**Why this shape:** the existing auth design already states *"participants/organizers
authenticate by phone alone (OTP drops in later); org/organizer passwords are never
returned."* An emailed magic link is the trust step, and the organizer's **phone
becomes their login identity** — so **no password is ever set for organizers** under
this flow. This is a deliberate move away from the password field, not an oversight.

### Key backend facts (verified 2026-07-12)
- Layering `routes → controllers → services → models`; controllers thin (no
  try/catch — Express 5 forwards async throws); throw `new HttpError(status, msg)`.
- **No email library is installed**; **no `email` field** on the user model.
- Sessions: `models/session.model.ts` stores `sha256(token)` + TTL index; the raw
  token is an httpOnly cookie `camply_sid`. `sessionService` creates/revokes them.
  Login sets the cookie via `config/cookies.ts`.
- `organizerService.create` (in `services/organizer.services.ts`) currently
  bcrypts a password and sets phone. Org-only routes are guarded by
  `requireAuth, requireRole('organization')` (`routes/organizer.routes.ts`).
- `utils/phone.ts#canonicalizePhone` turns 9 national digits into `+998…`.
- Validators use Zod from `config/zod` (not `'zod'`) so `.openapi()` attaches;
  applied via `validate({ body, params, query })`. Every endpoint is registered in
  `docs/openapi.ts`.
- Env is Zod-validated in `config/env.ts`; never read `process.env` elsewhere.

### Key frontend facts (verified 2026-07-12)
- Org admin surface at `/admin/*`: `DashboardScreen`, `AdminCampsScreen`,
  `OrganizersScreen` (+ `OrganizerRow`, `NewOrganizerSheet`). Data layer:
  `api/services/organizers.service.ts` + `api/queries/organizers.queries.ts`, keyed
  by `adminOrganizerKeys`.
- Auth session mirrors into `useAuthStore` (persisted); `useLogin` commits via
  `setSession`. Server calls go through `api/axiosInstance.ts` (`withCredentials`).
- Routing in `App.tsx`; participant/organizer/org trees are guarded. `PhoneInput`
  (`components/auth/PhoneInput.tsx`, `PHONE_LENGTH` from `lib/phone.ts`) is the shared
  9-digit phone entry. All copy is trilingual via `useTranslation()` → `t`.

---

## 2. Goal & scope

**Goal:** Replace one-step organizer creation with an emailed magic-link invite: the
org invites by email; the organizer self-completes by entering their phone via the
link and is logged straight into `/org`.

**In scope:**
1. Backend: `email` on user; `Invite` token model; email sending via **nodemailer**
   (Ethereal in dev, SMTP in prod); changed `POST /organizers`; new `resend`,
   `revoke (DELETE)`, and public `GET /invite/:token` + `POST /invite/:token/accept`.
2. Frontend: email-only create sheet; organizer **status** (Pending/Active/
   Deactivated) with **Resend**/**Revoke** on pending; a new **public**
   `/invite/:token` accept page; status-based dashboard stats (+ a Pending tile).
3. i18n for all new copy (UZ/RU/EN), including the accept page.

**Out of scope:** a real SMTP provider account (env-ready, wired when available);
per-recipient email localization (email ships clear + Uzbek-primary, localize later);
invite expiry reminders; invites for participants or other roles.

---

## 3. Decisions (and why)

1. **nodemailer with an Ethereal dev fallback** (user chose nodemailer). If `SMTP_*`
   env is present → real SMTP transport; else in dev → `nodemailer.createTestAccount()`
   and log `nodemailer.getTestMessageUrl(info)` so the email is viewable without any
   account. Flipping to real delivery = setting env, no code change.
2. **No password for organizers under this flow.** Phone (set at accept) is the login
   identity; matches the existing phone-auth design. The `passwordHash` field stays on
   the model (the org still uses it) but organizer creation no longer sets it.
3. **Status is derived, not stored.** `phone == null` (role organizer) → **pending**;
   else `active === true` → **active**, `false` → **deactivated**. Avoids a status
   field that could drift from `phone`/`active`.
4. **Revoke deletes the pending stub** (user confirmed) — a pending organizer never
   truly existed (no phone, never logged in), so revoke removes the user + token
   cleanly. Accepted organizers are never deleted; they deactivate via `PATCH {active}`.
5. **Invite token mirrors the session pattern** — separate `Invite` collection,
   `sha256(token)` stored, TTL index, **7-day** expiry (user confirmed), single-use
   (deleted on accept). Raw token only in the emailed link.
6. **Accept logs them in.** `POST /invite/:token/accept` creates a session (sets the
   `camply_sid` cookie) and returns the user, so the frontend navigates straight to
   `/org` with an authenticated session — same shape as `useLogin`.
7. **Accept endpoints are public** (no `requireAuth`) but token-gated; org-management
   endpoints stay `requireRole('organization')`.

---

## 4. Backend design detail

### 4.1 User model (`models/user.model.ts`)
Add:
```ts
email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
```
Sparse-unique so the many phone-based users without an email don't collide (same
pattern as `username`).

### 4.2 Invite model (`models/invite.model.ts`, new — mirror `session.model.ts`)
```ts
{
  userId: ObjectId (ref User, indexed),
  tokenHash: String (sha256 of the raw token, indexed, unique),
  email: String,                 // denormalized for the email + display
  expiresAt: Date,               // TTL index → auto-purge after expiry
}
```
Helper (in `inviteService`): `createInvite(userId, email)` → returns `{ rawToken,
invite }`; `consume(rawToken)` → validates hash + expiry, returns the invite or throws
`HttpError(410, 'Invite expired')` / `HttpError(404, 'Invalid invite')`.

### 4.3 Mailer (`services/mailer.service.ts`, new)
- Lazily builds a nodemailer transport: real SMTP if `env.SMTP_HOST` set, else an
  Ethereal test account (dev). Caches the transport.
- `sendOrganizerInvite({ to, name, link })` — sends a simple HTML+text email with the
  link. In dev logs `getTestMessageUrl(info)`. Returns `{ previewUrl? }`.
- Never throws into the request path fatally in dev: if the transport fails, log and
  continue (the invite still exists; the org can resend). *In prod a send failure
  should surface* — gate this on env so dev stays smooth.

### 4.4 Env (`config/env.ts`)
Add (all optional except APP_URL which has a dev default):
```
APP_URL          default 'http://localhost:5173'   // base for the invite link
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS          // optional → Ethereal if unset
MAIL_FROM        default 'Camply <no-reply@camply.dev>'
INVITE_TTL_DAYS  default 7
```

### 4.5 Organizer service (`services/organizer.services.ts`, changed)
- `PublicOrganizer` gains `email: string | null` and `status: 'pending' | 'active' |
  'deactivated'` (derived in `toPublicOrganizer`).
- `create({name, surname, email})`:
  - reject if `email` already used (409 'Email already registered');
  - create user `{ email, name, surname, role:'organizer', active:true }` (no phone,
    no passwordHash);
  - `inviteService.createInvite(user._id, email)` → rawToken;
  - `mailer.sendOrganizerInvite({ to: email, name, link: ${APP_URL}/invite/${rawToken} })`;
  - return `{ organizer, inviteUrl? }` (inviteUrl/previewUrl included only in dev).
- `resendInvite(id)`: pending only (phone null) → new token, resend. 404 if not
  pending.
- `revokeInvite(id)`: pending only → delete invite(s) + user. 404 if not pending.
- `setActive` unchanged (accepted organizers).

### 4.6 Invite service + accept (`services/invite.services.ts`, new)
- `getPublicInvite(rawToken)` → `{ name, email }` for the welcome screen (validates).
- `accept(rawToken, phone)`:
  - consume token; load the pending user; canonicalize phone; reject if phone taken
    (409); set `user.phone`, save; delete the invite; `sessionService.create(...)` →
    set cookie; return the public user (same shape `/auth/me` returns).

### 4.7 Routes & validators
- `routes/organizer.routes.ts`: `POST /` body → `createOrganizerSchema`
  (`{name, surname, email}`); add `POST /:id/resend`, `DELETE /:id`.
- `routes/invite.routes.ts` (new, **public**, mounted at `/invite`): `GET /:token`,
  `POST /:token/accept` (body `acceptInviteSchema { phone }`).
- Mount `/invite` in the routes index alongside `/auth`, `/organizers`.
- Validators (`validators/organizer.validators.ts`, `validators/invite.validators.ts`):
  `createOrganizerSchema` → `{ name, surname, email: z.string().email() }`;
  `acceptInviteSchema` → `{ phone: <9-digit> }` (reuse the phone rule from
  `auth.validators`); `inviteTokenParam`.
- Register every new endpoint in `docs/openapi.ts`.

---

## 5. Frontend design detail

### 5.1 Data layer (`api/services/organizers.service.ts` + queries)
- `Organizer` type: add `email: string | null`, `status: 'pending' | 'active' |
  'deactivated'`; `phone` stays (null while pending).
- `CreateOrganizerBody` → `{ name, surname, email }`. `create` returns
  `{ organizer, inviteUrl? }`.
- Add `resendInvite(id)` (`POST /organizers/:id/resend`) and `revokeInvite(id)`
  (`DELETE /organizers/:id`). New query hooks `useResendInvite`, `useRevokeInvite`
  (invalidate `adminOrganizerKeys`).
- New `invites.service.ts` + `invites.queries.ts` for the public page:
  `getInvite(token)` (`GET /invite/:token`) and `acceptInvite(token, {phone})`
  (`POST /invite/:token/accept`) → on success `setUser(user)` (the store's setter;
  the accept response is `{ user }`, same shape as `/auth/login`).

### 5.2 Create sheet (`NewOrganizerSheet`)
Remove phone + password; add an **email** `Field` (type=email). Valid = name +
surname + a basic email regex. On success: close + toast/inline "Invitation sent to
{email}"; in dev, if `inviteUrl` present, show a copyable link (handy without a real
inbox).

### 5.3 Organizer row (`OrganizerRow`)
Status `Badge`: **Pending** (amber, subtitle = email), **Active** (pine, subtitle =
phone), **Deactivated** (muted, subtitle = phone). Actions by status:
- pending → **Resend** + **Revoke** (revoke confirms; deletes the invite);
- active → **Deactivate**; deactivated → **Reactivate** (existing).

### 5.4 Public accept page (`components/invite/InviteAcceptScreen.tsx`, new)
- Route `/invite/:token` in `App.tsx`, **outside** the auth guards (public).
- On mount: `useInvite(token)` → loading / invalid / expired / ready. Ready shows
  "Welcome {name}" + `PhoneInput`.
- Submit → `acceptInvite` → `setSession` → `navigate('/org')`.
- On-brand pine→deep backdrop like `AdminLogin`; trilingual; theme-safe.

### 5.5 Dashboard stats
Compute from `status`: Organizers (total) · Active (`status==='active'`) · **Pending**
(`status==='pending'`) · Camps. (Replaces the current active/deactivated split so a
pending organizer isn't miscounted as active. Keep it 4 tiles.)

### 5.6 i18n
New keys under `t.admin.create` (email, sent confirmation), `t.admin.organizers`
(pending/resend/revoke/confirmRevoke), `t.admin.dashboard.stats.pending`, and a new
`t.invite.*` tree for the accept page (welcome, phone label, submit, invalid, expired,
loadError, success). All in UZ/RU/EN.

---

## 6. Files (summary)

**Backend — new:** `models/invite.model.ts`, `services/invite.services.ts`,
`services/mailer.service.ts`, `routes/invite.routes.ts`,
`controllers/invite.controllers.ts`, `validators/invite.validators.ts`.
**Backend — modified:** `models/user.model.ts`, `services/organizer.services.ts`,
`controllers/organizer.controllers.ts`, `validators/organizer.validators.ts`,
`routes/organizer.routes.ts`, `routes/index.ts` (mount), `config/env.ts`,
`docs/openapi.ts`, `package.json` (add `nodemailer` + `@types/nodemailer`).

**Frontend — new:** `components/invite/InviteAcceptScreen.tsx`,
`api/services/invites.service.ts`, `api/queries/invites.queries.ts`.
**Frontend — modified:** `api/services/organizers.service.ts`,
`api/queries/organizers.queries.ts`, `api/queryKeys.ts` (invite key),
`components/organization/organizers/NewOrganizerSheet.tsx`, `.../OrganizerRow.tsx`,
`components/organization/dashboard/DashboardScreen.tsx`, `App.tsx`,
`i18n/translations.ts`.

---

## 7. Verification (the working bar)

**Backend (curl + Ethereal):**
1. Login as org; `POST /organizers {name,surname,email}` → 201, response has
   `inviteUrl`/preview URL; server logs the Ethereal preview link.
2. `GET /invite/:token` → `{name,email}`; a bad token → 404; expired → 410.
3. `POST /invite/:token/accept {phone}` → 200, sets cookie; the user now has the phone
   and role organizer; token is gone (second accept → 404).
4. `GET /organizers` → the organizer now shows `status:'active'` with the phone; a
   still-pending one shows `status:'pending'` with email + null phone.
5. `POST /organizers/:id/resend` (pending) → new token emailed; `DELETE /organizers/:id`
   (pending) → user + invite gone; both reject non-pending with 404.
6. Duplicate email on create → 409; accept with an already-registered phone → 409.

**Frontend (headless Chrome, real backend):** create via the email-only sheet → row
shows **Pending**; open the dev invite link in the same driver → welcome renders →
enter phone → lands on `/org` authenticated; back in `/admin/organizers` the row is
now **Active** with the phone; Resend + Revoke work on a pending row; dashboard Pending
tile reflects counts. Dark mode + mobile intact.

**Gates:** backend `npm run validate` (lint+format:check+typecheck) and frontend
`npm run validate` both pass. Format only touched files.

---

## 8. Guardrails
Hierarchy enforced server-side (org-only management routes unchanged). Token random +
hashed + TTL + single-use. Accept is public but token-gated and re-checks phone
uniqueness. No password introduced. Trilingual, design-system tokens, dark mode, PWA
health all preserved. Email localization is a noted later enhancement.

## 9. Open items for the plan
- Exact nodemailer transport construction + Ethereal fallback caching.
- Where the "invite sent / copy link" affordance lives in the sheet (inline vs toast).
- Whether `resend`/`revoke` reuse the existing `OrganizerRow` confirm pattern
  (`window.confirm`) — yes, for consistency, v1.
