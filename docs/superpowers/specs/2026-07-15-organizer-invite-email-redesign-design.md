# Organizer Invite Email — Redesign & Sender Change

**Date:** 2026-07-15
**Repo:** camply-backend
**Status:** Approved design, pending implementation plan

## Problem

The organizer invite email (`src/services/mailer.service.ts`) is a plain,
unstyled HTML string. We want it to look branded and professional — Camply
logo, brand palette, a clear call-to-action button, and a subtle animation.
Separately, the SMTP sender is changing from `javohirmirzakhalov@gmail.com`
to `camplyuz@gmail.com`.

## Goals

1. Swap the SMTP sender to `camplyuz@gmail.com` (config only).
2. Redesign the invite email into a branded, attractive HTML template.
3. One subtle animated-GIF accent (email-safe animation).
4. Keep a plain-text fallback in sync with the HTML.

## Non-goals (explicit, for scope control)

- **Trilingual copy (EN/UZ/RU).** Email stays **Uzbek-only for now.** This is a
  known deviation from the project's trilingual guardrail and is tracked as a
  follow-up — not part of this change.
- No new emails (password reset, welcome, etc.). Just the organizer invite.
- No email templating engine (MJML/React Email). Considered and deferred; a
  single email does not justify a new dependency.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Animation level | One subtle GIF accent (static design + a single small looping GIF; degrades to a static frame in Gmail) |
| Language | Uzbek only for now (follow-up: make trilingual) |
| Logo/hosting | User has a logo; needs a public URL. Host under frontend `public/email/`, referenced via `MAIL_ASSET_BASE_URL` env var |
| Build approach | Hand-crafted table-based HTML in its own module. No new dependency |

## Part 1 — Sender change (config only)

Update `.env` (no code change):

```
SMTP_USER=camplyuz@gmail.com
SMTP_PASS=<new Gmail App Password>
MAIL_FROM=Camply <camplyuz@gmail.com>
```

Prerequisites (done by the user in the `camplyuz@gmail.com` Google account):
enable 2-Step Verification, then generate an App Password for "Mail".

Constraint: Gmail forces the `From` address to match the authenticated
`SMTP_USER`, so `MAIL_FROM`'s address must be `camplyuz@gmail.com`; only the
display name is free.

Security check: confirm `.env` is gitignored — it holds live secrets.

## Part 2 — Email redesign

### Architecture (isolation)

- **New module `src/emails/organizerInvite.ts`** — pure function:
  `renderOrganizerInvite({ name, link }) => { subject, html, text }`.
  Owns all markup. No send logic, no I/O.
- **`src/services/mailer.service.ts`** — keeps only transport + send. Calls
  `renderOrganizerInvite(...)` and passes the result to `transport.sendMail`.
  This separates "how it looks" from "how it's sent" so either can change
  independently.

### New env var

- `MAIL_ASSET_BASE_URL` (in `src/config/env.ts`, zod, optional with a sensible
  default) — public base URL for email images, e.g.
  `https://camply.uz/email`. The template builds image `src`s from it. Lets us
  swap placeholder → real hosted URL with no code change.

### Visual design

- Brand palette (`Context.md` §5): Pine `#0f6b4f`, Deep `#0A5039`,
  Amber `#e0982a`, Paper `#f4f1ea`, ink `#16271f`. ~16px radius, soft shadow.
- Centered 600px card on Paper background (email-safe max width).
- **Header:** Deep-green band, centered Camply logo. Subtle GIF accent here;
  static logo fallback in Gmail.
- **Body:** `Salom ${name}` greeting, one-sentence invite explanation, big
  Amber CTA button "Taklifni qabul qilish" (bulletproof VML button for Outlook),
  plain-text fallback link below.
- **Footer:** "Havola 7 kun amal qiladi" + muted Camply signature.
- Tables for layout, inline styles throughout (email-client constraint).

### Assets to produce (user)

- Static logo PNG (from existing `pwa-512x512.png` if desired).
- One small looping GIF accent (animated logo or gentle accent).
- Host both under frontend `public/email/`; deploy frontend to a public URL.

## Testing / verification

- Local render: write the generated HTML to a file and open it in a browser to
  eyeball layout.
- Real-send test via the existing Ethereal dev transport (preview URL logged) —
  no SMTP creds needed to preview the new template.
- Once SMTP is switched, send one real invite to a test inbox and confirm the
  sender shows "Camply", logo renders, GIF animates (or falls back cleanly),
  and the CTA link works.

## Follow-ups (out of scope, tracked)

- Make the invite email trilingual (EN/UZ/RU) per the project guardrail.
- If more transactional emails appear, revisit MJML/React Email.
