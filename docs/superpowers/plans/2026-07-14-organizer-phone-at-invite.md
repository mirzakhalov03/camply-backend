# Organizer phone at invite time — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.
> Spec: `../specs/2026-07-14-organizer-phone-at-invite-design.md`.

**Goal:** The org records an organizer's phone when inviting them; the organizer
confirms the invite with one tap instead of typing their phone.

**Architecture:** Move phone capture from accept → create. Replace the "has a
phone?" pending signal with an explicit `acceptedAt` timestamp, and guard
`authService.login` so a not-yet-accepted organizer can't skip the email by
logging in via phone.

**Tech Stack:** Express 5 · Mongoose 9 · Zod 4 (backend); React 19 · React Query ·
Zustand · Tailwind v4 (frontend).

## Global Constraints

- **No test runner** — verify with `npm run typecheck` / `npm run validate` and
  curl / the running app. Do not add tests.
- **Commits require the user's explicit permission** (project rule). Prepare the
  commit but do not run `git commit` until approved.
- **Trilingual** — every new/changed user-facing string ships EN/UZ/RU in
  `i18n/translations.ts`. No hard-coded copy.
- **Phone format** — frontend sends 9 raw digits; backend canonicalizes to
  `+998…` via `utils/phone.canonicalizePhone`. Validation rule everywhere:
  `/^\d{9}$/`.
- **Backend layering** — `routes → controllers → services → models`; controllers
  thin (no try/catch); throw `new HttpError(status, message)`. Import `z` from
  `config/zod`.
- Two separate git repos: run `validate` inside each repo you touched.

---

### Task 1: Backend — capture phone at create, switch pending signal to `acceptedAt`

**Files:**
- Modify: `camply-backend/src/models/user.model.ts`
- Modify: `camply-backend/src/validators/organizer.validators.ts`
- Modify: `camply-backend/src/services/organizer.services.ts`

**Interfaces:**
- Produces: `User.acceptedAt?: Date` (pending = unset); `CreateOrganizerInput`
  gains `phone: string` (9 digits); `organizerService.create` stores a
  canonicalized, unique-checked phone.

- [ ] **Step 1: Add `acceptedAt` to the user model.**
  In `user.model.ts`, add inside the schema (near `active`):
  ```ts
  // Set when an invited organizer accepts. Absent ⇒ still pending. (Replaces the
  // old "no phone yet ⇒ pending" heuristic now that phone is set at invite time.)
  acceptedAt: { type: Date },
  ```

- [ ] **Step 2: Add `phone` to the create-organizer schema.**
  In `organizer.validators.ts`, add to `createOrganizerSchema`:
  ```ts
  phone: z.string().regex(/^\d{9}$/, 'Phone must be 9 digits'),
  ```

- [ ] **Step 3: Store the phone on create + unique-check it.**
  In `organizer.services.ts` `create`, after the email dup check and before
  `UserModel.create`, add:
  ```ts
  const phone = canonicalizePhone(input.phone)
  const phoneTaken = await UserModel.exists({ phone })
  if (phoneTaken) throw new HttpError(409, 'Phone already registered')
  ```
  Add `phone` to the `UserModel.create({...})` object. Import at top:
  ```ts
  import { canonicalizePhone } from '../utils/phone'
  ```

- [ ] **Step 4: Switch the pending signal.**
  In `organizer.services.ts` `statusOf`, change:
  ```ts
  if (!user.acceptedAt) return 'pending' // was: if (!user.phone)
  ```

- [ ] **Step 5: Fix the resend/revoke guards.**
  In `resendInvite` and `revokeInvite`, change both `if (user.phone) throw …`
  guards to `if (user.acceptedAt) throw …` (keep the existing messages).

- [ ] **Step 6: Verify.**
  ```bash
  cd camply-backend && npm run typecheck
  ```
  Expected: no errors. Then with the dev server + a seeded org session cookie:
  ```bash
  curl -sX POST localhost:4000/api/organizers -H 'Content-Type: application/json' \
    -b cookies.txt -d '{"name":"Aziz","surname":"K","email":"aziz@x.uz","phone":"901234567"}'
  ```
  Expected: `201` with `"status":"pending"`, `"phone":"+998901234567"`, and an
  `inviteUrl`. A second call with the same phone → `409 Phone already registered`.

- [ ] **Step 7: Commit (after approval).**
  ```bash
  git -C camply-backend add src/models/user.model.ts src/validators/organizer.validators.ts src/services/organizer.services.ts
  git -C camply-backend commit -m "feat(organizer): capture phone at invite; acceptedAt pending signal"
  ```

---

### Task 2: Backend — accept without phone (sets `acceptedAt`)

**Files:**
- Modify: `camply-backend/src/validators/invite.validators.ts`
- Modify: `camply-backend/src/services/invite.services.ts`
- Modify: `camply-backend/src/controllers/invite.controllers.ts`

**Interfaces:**
- Consumes: `User.acceptedAt` (Task 1).
- Produces: `inviteService.accept(rawToken, userAgent?)` — no phone param; sets
  `acceptedAt`. Accept request body is now empty.

- [ ] **Step 1: Empty the accept schema.**
  In `invite.validators.ts`, replace `acceptInviteSchema` with:
  ```ts
  export const acceptInviteSchema = z.object({})
  ```
  Delete the now-unused `phone` const and `AcceptInviteInput` type if nothing
  else references them (check `controllers/invite.controllers.ts`).

- [ ] **Step 2: Drop phone from `accept`.**
  In `invite.services.ts`, change the signature to
  `accept: async (rawToken: string, userAgent?: string) => {`, remove the
  `phone`/`taken` block, and replace the mutation with:
  ```ts
  user.acceptedAt = new Date()
  user.active = true
  await user.save()
  ```
  Remove the now-unused `canonicalizePhone` import if unreferenced elsewhere in
  the file.

- [ ] **Step 3: Update the controller.**
  In `invite.controllers.ts`, call `inviteService.accept(token, req.headers['user-agent'])`
  (drop the `phone` argument / body read). Keep the cookie-set + response shape.

- [ ] **Step 4: Verify.**
  ```bash
  cd camply-backend && npm run typecheck
  ```
  Then, using the `inviteUrl` token from Task 1:
  ```bash
  curl -sX POST localhost:4000/api/invite/<TOKEN>/accept -H 'Content-Type: application/json' -d '{}' -i
  ```
  Expected: `200`, a `Set-Cookie: camply_sid=…`, and the organizer JSON. Re-listing
  organizers shows that one as `"status":"active"` with `acceptedAt` set.

- [ ] **Step 5: Commit (after approval).**
  ```bash
  git -C camply-backend add src/validators/invite.validators.ts src/services/invite.services.ts src/controllers/invite.controllers.ts
  git -C camply-backend commit -m "feat(invite): accept sets acceptedAt; no phone in body"
  ```

---

### Task 3: Backend — block phone login before accept

**Files:**
- Modify: `camply-backend/src/services/auth.services.ts`

**Interfaces:**
- Consumes: `User.acceptedAt` (Task 1).

- [ ] **Step 1: Add the guard.**
  In `auth.services.ts` `login`, after the `if (!user.active)` check and before
  the password block, add:
  ```ts
  // An invited organizer must accept the email link first; the pre-set phone
  // alone must not grant entry (email is the way in).
  if (user.role === 'organizer' && !user.acceptedAt) {
    throw new HttpError(401, 'Invalid credentials')
  }
  ```

- [ ] **Step 2: Verify.**
  ```bash
  cd camply-backend && npm run typecheck
  ```
  Create a fresh pending organizer (Task 1 curl) but do **not** accept, then:
  ```bash
  curl -sX POST localhost:4000/api/auth/login -H 'Content-Type: application/json' \
    -d '{"phone":"901234567"}' -i
  ```
  Expected: `401`. After accepting (Task 2), the same login → `200`.

- [ ] **Step 3: Commit (after approval).**
  ```bash
  git -C camply-backend add src/services/auth.services.ts
  git -C camply-backend commit -m "feat(auth): block organizer phone login before invite accept"
  ```

---

### Task 4: Backend — OpenAPI docs

**Files:**
- Modify: `camply-backend/src/docs/openapi.ts`

- [ ] **Step 1: Update registered schemas.**
  Ensure the create-organizer path references `createOrganizerSchema` (now with
  `phone`) and the accept path references the emptied `acceptInviteSchema`. If the
  request bodies are declared inline rather than via the validator schemas, update
  them to match (add `phone` to create; empty body for accept).

- [ ] **Step 2: Verify.**
  ```bash
  cd camply-backend && npm run validate
  ```
  Expected: lint + format + typecheck pass. Load `localhost:4000/api/docs` — the
  create-organizer body shows `phone`; accept shows no body.

- [ ] **Step 3: Commit (after approval).**
  ```bash
  git -C camply-backend add src/docs/openapi.ts
  git -C camply-backend commit -m "docs(openapi): organizer phone on create; empty accept body"
  ```

---

### Task 5: Frontend — phone field in the create sheet

**Files:**
- Modify: `camply-frontend/src/api/services/organizers.service.ts`
- Modify: `camply-frontend/src/components/organization/organizers/NewOrganizerSheet.tsx`
- Modify: `camply-frontend/src/i18n/translations.ts`
- Reuse: `camply-frontend/src/components/auth/PhoneInput.tsx`

**Interfaces:**
- Produces: create payload now includes `phone` (9 digits).

- [ ] **Step 1: Add `phone` to the create request type/payload** in
  `organizers.service.ts` (the `create` request body type gains
  `phone: string`). `PublicOrganizer` already has `phone`.

- [ ] **Step 2: Add the phone field to the sheet.** In `NewOrganizerSheet.tsx`,
  add phone state, render `<PhoneInput>` below the email field, block submit until
  it's 9 digits, and include `phone` in the mutation payload. Surface a `409`
  ("Phone already registered") as a field error, mirroring the email-dup handling.

- [ ] **Step 3: Add i18n keys** for the phone label + validation/duplicate error
  in EN/UZ/RU under the organizers-admin translation group.

- [ ] **Step 4: Verify.**
  ```bash
  cd camply-frontend && npm run typecheck
  ```
  In the app (`/admin/organizers` → add): the sheet shows a phone field; submitting
  a valid one creates a pending organizer; a duplicate phone shows the translated
  error. Check all three languages render the label.

- [ ] **Step 5: Commit (after approval).**
  ```bash
  git -C camply-frontend add src/api/services/organizers.service.ts src/components/organization/organizers/NewOrganizerSheet.tsx src/i18n/translations.ts
  git -C camply-frontend commit -m "feat(admin): phone field when inviting an organizer"
  ```

---

### Task 6: Frontend — simplify the accept screen (confirm, no phone)

**Files:**
- Modify: `camply-frontend/src/components/organizer/InviteAccept.tsx`
- Modify: `camply-frontend/src/api/services/invite.service.ts`
- Modify: `camply-frontend/src/api/queries/invite.queries.ts`
- Modify: `camply-frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: backend accept with empty body (Task 2).

- [ ] **Step 1: `acceptInvite` sends no phone.** In `invite.service.ts`, change
  the accept call to `POST /invite/:token/accept` with no body; drop the phone
  param. In `invite.queries.ts`, update `useAcceptInvite` to match (mutation takes
  only the token).

- [ ] **Step 2: Rework `InviteAccept.tsx`.** Remove the `PhoneInput` and phone
  state; render the greeting (`GET /invite/:token` name) + a single primary
  "Accept & continue" `Button` that calls the mutation → on success go to
  `/org/welcome`. Keep loading/error states.

- [ ] **Step 3: Update i18n** — remove/repurpose the phone-prompt strings; add the
  "Accept & continue" button + confirmation copy in EN/UZ/RU.

- [ ] **Step 4: Verify.**
  ```bash
  cd camply-frontend && npm run typecheck
  ```
  Open a dev `inviteUrl` in the browser: the accept screen greets by name and
  shows one button, no phone input; tapping it lands on `/org/welcome` with a
  session. Check all three languages.

- [ ] **Step 5: Commit (after approval).**
  ```bash
  git -C camply-frontend add src/components/organizer/InviteAccept.tsx src/api/services/invite.service.ts src/api/queries/invite.queries.ts src/i18n/translations.ts
  git -C camply-frontend commit -m "feat(invite): one-tap accept; phone already on file"
  ```

---

### Task 7 (optional polish): Frontend — show phone on pending organizer rows

**Files:**
- Modify: `camply-frontend/src/components/organization/organizers/OrganizerRow.tsx`

- [ ] **Step 1:** In the `pending` branch, show the phone alongside the email
  (the phone now exists at the pending stage). Keep the amber status styling.

- [ ] **Step 2: Verify** `npm run typecheck` and eyeball a pending row.

- [ ] **Step 3: Commit (after approval).**
  ```bash
  git -C camply-frontend add src/components/organization/organizers/OrganizerRow.tsx
  git -C camply-frontend commit -m "feat(admin): show phone on pending organizer rows"
  ```

---

## Final verification

- [ ] `npm run validate` passes in **both** repos.
- [ ] End-to-end: org invites with phone → pending (can't phone-login) → open
  invite link → one-tap accept → session → `/org/welcome` → later, phone login
  works. Copy renders in EN/UZ/RU.

## Dev-data note

Existing dev organizers (phone, no `acceptedAt`) now read as pending. Backfill:
```js
db.users.updateMany({ role: 'organizer', phone: { $ne: null } }, { $set: { acceptedAt: new Date() } })
```
