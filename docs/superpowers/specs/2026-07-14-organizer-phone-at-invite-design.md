# Organizer phone captured at invite time — Design

**Date:** 2026-07-14
**Surfaces:** Organization admin (create organizer) + Organizer onboarding (accept invite)
**Repos:** `camply-backend` (core) + `camply-frontend`

## Summary

When the organization adds an organizer, it should also record the organizer's
**phone number** alongside name, surname, and email. The phone moves from the
*accept* step (where the organizer types it today) to the *create* step (the org
types it up front). The email magic-link stays the way in; the phone is contact
info on file.

## Goal & non-goals

**Goal:** the org enters `name, surname, email, phone` when inviting an organizer;
the organizer no longer types their phone during accept — they just confirm.

**Non-goals (out of scope):**
- No phone-based login for organizers. Email link remains the only door.
  (User decision: "keep email link, phone is just on file.")
- No "edit organizer phone later" endpoint (no organizer-edit endpoint exists;
  YAGNI).
- No OTP / phone verification (already a known pre-launch gap, unchanged here).

## Current behavior (what exists today)

1. `POST /organizers` takes `{ name, surname, email }` → creates a **pending**
   organizer with **no phone**, issues an `Invite`, emails a magic link.
2. `GET /invite/:token` → `{ name, email }` for the accept screen.
3. `POST /invite/:token/accept { phone }` → binds the phone, activates, deletes
   the invite, starts a session.
4. **Pending vs. accepted is derived from the phone:** `statusOf()` in
   `organizer.services.ts` returns `pending` when `!user.phone`, else
   `active`/`deactivated` by the `active` flag.

## New behavior

1. `POST /organizers` takes `{ name, surname, email, phone }` → creates a
   **pending** organizer **with** phone (canonicalized, unique-checked), issues an
   `Invite`, emails a magic link. `acceptedAt` is unset ⇒ status `pending`.
2. `GET /invite/:token` → `{ name, email }` (unchanged).
3. `POST /invite/:token/accept` (no body) → sets `acceptedAt`, ensures `active`,
   deletes the invite, starts a session. Phone is already on the user.
4. Organizer accept screen: greet by name + a single **"Accept & continue"**
   button. No phone input.

## Design decisions

### 1. Explicit `acceptedAt` replaces "has a phone?" as the pending signal

`statusOf` currently overloads the phone field to mean both "has contact info"
**and** "has accepted the invite." Once the phone is set at create time, those two
meanings split. We add an explicit `acceptedAt?: Date` on the user:

- `!acceptedAt` → `pending`
- `acceptedAt` set → `active` (or `deactivated` when `active === false`)

`acceptedAt` is organizer-only in practice; it stays `undefined` for participants
and the org super-admin, which never consult it.

### 2. Guard: an organizer cannot log in by phone before accepting

Organizers log in by **phone alone** with no password (the password branch in
`authService.login` is skipped when there's no `passwordHash`). Once the org sets
the phone at create time, a **not-yet-accepted** organizer could log in by phone
and skip the email link entirely — defeating "email is the way in."

Fix: in `authService.login`, after the user is resolved, reject when
`user.role === 'organizer' && !user.acceptedAt` with the standard
`401 Invalid credentials`. The email accept becomes the sole first-entry gate;
after accept (`acceptedAt` set), normal phone login works.

## Backend changes (`camply-backend`)

- **`models/user.model.ts`** — add `acceptedAt: { type: Date }` (optional).
- **`validators/organizer.validators.ts`** — add `phone` to `createOrganizerSchema`
  using the shared 9-digit rule: `z.string().regex(/^\d{9}$/, 'Phone must be 9 digits')`.
- **`services/organizer.services.ts`**
  - `create`: `canonicalizePhone(input.phone)`, reject a taken phone with
    `409 'Phone already registered'` (mirror the existing email check), store the
    phone. Do **not** set `acceptedAt` (stays pending).
  - `statusOf`: switch `if (!user.phone)` → `if (!user.acceptedAt)`.
  - `resendInvite` / `revokeInvite`: change the "already active" guard from
    `if (user.phone)` → `if (user.acceptedAt)`.
- **`validators/invite.validators.ts`** — `acceptInviteSchema` becomes an empty
  object `z.object({})` (no phone in the body).
- **`services/invite.services.ts`** — `accept(rawToken, userAgent?)` drops the
  `phoneRaw` param and the phone canonicalize/uniqueness block; sets
  `user.acceptedAt = new Date()`, ensures `user.active = true`, deletes the invite,
  starts the session. (The `role === 'organizer'` check stays.)
- **`controllers/invite.controllers.ts`** — stop reading `phone` from the body.
- **`services/auth.services.ts`** — add the not-accepted-organizer login guard
  (decision 2).
- **`docs/openapi.ts`** — update the create-organizer request schema (add phone)
  and the accept request schema (now empty).

## Frontend changes (`camply-frontend`)

- **`components/organization/organizers/NewOrganizerSheet.tsx`** — add a phone
  field, reusing the existing `auth/PhoneInput` component; include it in the
  submit payload; validate it's 9 digits before submit.
- **`api/services/organizers.service.ts`** — add `phone` to the create request
  type/payload. (`PublicOrganizer` already carries `phone`.)
- **`components/organization/organizers/OrganizerRow.tsx`** — pending rows may now
  show the phone alongside the email (it exists at pending stage now).
- **`components/organizer/InviteAccept.tsx`** — remove the phone input; render the
  greeting + a single "Accept & continue" button.
- **`api/services/invite.service.ts`** + **`api/queries/invite.queries.ts`** —
  `acceptInvite` / `useAcceptInvite` send an empty body (no phone).
- **i18n (`i18n/translations.ts`)** — EN/UZ/RU for the new phone field label/error
  in the create sheet and the simplified accept-screen copy.

## Edge cases

- **Phone already registered at create** → `409` (same shape as the email
  collision), surfaced as a field error in the sheet.
- **Phone formatting** — frontend sends 9 raw digits; backend `canonicalizePhone`
  stores `+998…`, consistent with login/roster.
- **Duplicate invite of the same person** — email uniqueness (409) still catches
  it first; phone uniqueness is a second backstop.
- **Deactivate/reactivate** (`setActive`) — unchanged; operates on accepted
  organizers via the `active` flag.

## Dev-data migration (dev only, pre-launch)

Organizers already in a dev DB have a phone but no `acceptedAt`, so after this
change they'd read as `pending` and be blocked from phone login until re-accepting.
One-line backfill in the target DB:

```js
db.users.updateMany(
  { role: 'organizer', phone: { $ne: null } },
  { $set: { acceptedAt: new Date() } }
)
```

(Or just re-run the org/organizer seed. A fresh DB is unaffected.)

## Acceptance criteria

1. Org creates an organizer with `name, surname, email, phone`; a pending organizer
   is created with the phone stored and `status: 'pending'`; the invite email is
   sent.
2. A duplicate phone at create returns `409` and the sheet shows a clear,
   translated error.
3. A pending (not-yet-accepted) organizer **cannot** log in by phone (`401`).
4. `GET /invite/:token` still returns `{ name, email }`; the accept screen shows a
   greeting + "Accept & continue" with **no** phone input.
5. Accept sets `acceptedAt`, starts a session, lands on `/org/welcome`; the
   organizer then logs in by phone normally.
6. All new/changed copy ships EN/UZ/RU; no hard-coded strings.
7. `npm run validate` passes in both repos.
