# Organizer Invite Email Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the organizer invite email into a branded, animated HTML template, split cleanly from the send logic, and switch the SMTP sender to `camplyuz@gmail.com`.

**Architecture:** A new pure module `src/emails/organizerInvite.ts` owns all markup (returns `{ subject, html, text }`); `src/services/mailer.service.ts` keeps only transport + send and calls the renderer. Email images resolve from an asset base URL (env-driven), defaulting to `${APP_URL}/email`.

**Tech Stack:** TypeScript, nodemailer (existing). No new dependencies.

## Global Constraints

- Copy is **Uzbek only** (trilingual is a tracked follow-up, out of scope).
- Brand palette (verbatim): Pine `#0f6b4f`, Deep `#0A5039`, Amber `#e0982a`, Paper `#f4f1ea`, ink `#16271f`. Radius ~16px.
- Email HTML uses **`<table>` layout + inline styles only** (email-client constraint). No `<style>` blocks relied on, no flexbox/grid, no JS.
- **No new npm dependencies.**
- User-provided `name` MUST be HTML-escaped before interpolation into HTML.
- Images referenced via `assetBase` = `env.MAIL_ASSET_BASE_URL ?? \`${env.APP_URL}/email\``.
- **Commits are gated on the user's explicit permission** (project rule: never commit without permission). Commit steps below are the intended boundaries; do not run them until the user says so.
- No test framework exists in this repo — verification is `npm run typecheck` + a rendered HTML preview, not unit tests.

---

### Task 1: Config — asset base URL env var + sender vars

**Files:**
- Modify: `src/config/env.ts` (env schema)
- Manual (user): `.env` (SMTP sender secrets)

**Interfaces:**
- Produces: `env.MAIL_ASSET_BASE_URL: string | undefined`

- [ ] **Step 1: Add `MAIL_ASSET_BASE_URL` to the zod schema in `src/config/env.ts`**

Add this line alongside the other `MAIL_*` / `SMTP_*` entries:

```ts
  // Public base URL for email images (logo/GIF). If unset, defaults at
  // render time to `${APP_URL}/email`. Set to a CDN/host once assets are live.
  MAIL_ASSET_BASE_URL: z.string().optional(),
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3 (manual, user): update `.env` sender values once the Gmail App Password exists**

```
SMTP_USER=camplyuz@gmail.com
SMTP_PASS=<new 16-char Gmail App Password>
MAIL_FROM=Camply <camplyuz@gmail.com>
```

Prerequisite: on `camplyuz@gmail.com`, enable 2-Step Verification, then generate an App Password for "Mail". Gmail forces `From` to match `SMTP_USER`, so keep the address as `camplyuz@gmail.com` (display name is free).

- [ ] **Step 4: Confirm `.env` is gitignored (it holds live secrets)**

Run: `git check-ignore .env`
Expected: prints `.env` (meaning it is ignored). If it prints nothing, add `.env` to `.gitignore` before any commit.

- [ ] **Step 5: Commit (only with permission)**

```bash
git add src/config/env.ts
git commit -m "feat(email): add MAIL_ASSET_BASE_URL config for email assets"
```

---

### Task 2: Email template module

**Files:**
- Create: `src/emails/organizerInvite.ts`

**Interfaces:**
- Consumes: `env.MAIL_ASSET_BASE_URL`, `env.APP_URL` from `../config/env`
- Produces: `renderOrganizerInvite(params: { name: string; link: string }): { subject: string; html: string; text: string }`

- [ ] **Step 1: Create `src/emails/organizerInvite.ts` with the full template**

```ts
import { env } from '../config/env'

/*
  Organizer invite email. Pure: takes recipient name + magic link, returns the
  subject, an email-safe HTML body (table layout, inline styles — the only thing
  Gmail/Outlook render reliably), and a plain-text fallback. No sending here.
*/

/** Escape the 5 HTML-significant chars so a recipient name can't break/inject markup. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderOrganizerInvite({
  name,
  link,
}: {
  name: string
  link: string
}): { subject: string; html: string; text: string } {
  const assetBase = env.MAIL_ASSET_BASE_URL ?? `${env.APP_URL}/email`
  const safeName = escapeHtml(name)
  const subject = 'Camply — tashkilotchi taklifnomasi'

  const text =
    `Salom ${name},\n\n` +
    `Siz Camply'ga tashkilotchi sifatida taklif qilindingiz. Boshlash uchun ` +
    `quyidagi havolani oching va telefon raqamingizni kiriting:\n\n${link}\n\n` +
    `Havola 7 kun amal qiladi.\n\n— Camply jamoasi`

  const html = `<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f1ea;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f1ea;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(10,80,57,0.12);">
        <tr>
          <td align="center" style="background-color:#0A5039;padding:32px 24px;">
            <img src="${assetBase}/logo.gif" width="72" height="72" alt="Camply" style="display:block;border:0;outline:none;text-decoration:none;">
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 8px 32px;color:#16271f;">
            <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:#0f6b4f;">Salom ${safeName}! 👋</h1>
            <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#16271f;">Siz <strong>Camply</strong>'ga tashkilotchi sifatida taklif qilindingiz. Boshlash uchun quyidagi tugmani bosing va telefon raqamingizni kiriting.</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 32px 8px 32px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${link}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="34%" strokecolor="#e0982a" fillcolor="#e0982a">
              <w:anchorlock/>
              <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Taklifni qabul qilish</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a href="${link}" style="background-color:#e0982a;color:#ffffff;display:inline-block;font-size:16px;font-weight:bold;line-height:48px;text-align:center;text-decoration:none;width:260px;border-radius:16px;-webkit-text-size-adjust:none;">Taklifni qabul qilish</a>
            <!--<![endif]-->
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 24px 32px;color:#16271f;">
            <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#5b6b63;">Tugma ishlamasa, quyidagi havolani brauzerga nusxalang:</p>
            <p style="margin:0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${link}" style="color:#0f6b4f;">${link}</a></p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#f4f1ea;padding:20px 32px;border-top:1px solid #e6e1d6;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#8a978f;">Havola 7 kun amal qiladi. Agar bu taklifni kutmagan bo'lsangiz, ushbu xatni e'tiborsiz qoldiring.</p>
            <p style="margin:12px 0 0 0;font-size:12px;color:#8a978f;">— Camply jamoasi</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`

  return { subject, html, text }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit (only with permission)**

```bash
git add src/emails/organizerInvite.ts
git commit -m "feat(email): branded organizer invite template module"
```

---

### Task 3: Wire the mailer to the new template

**Files:**
- Modify: `src/services/mailer.service.ts`

**Interfaces:**
- Consumes: `renderOrganizerInvite` from `../emails/organizerInvite`

- [ ] **Step 1: Import the renderer at the top of `src/services/mailer.service.ts`**

```ts
import { renderOrganizerInvite } from '../emails/organizerInvite'
```

- [ ] **Step 2: Replace the inline subject/text/html in `sendOrganizerInvite` with the rendered result**

Replace the `transport.sendMail({ ... })` call body so it reads:

```ts
    const { subject, html, text } = renderOrganizerInvite({ name, link })
    const info = await transport.sendMail({
      from: env.MAIL_FROM,
      to,
      subject,
      text,
      html,
    })
```

(Delete the old inline `subject:`, `text:` and `html:` string literals — they now live in the template module.)

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit (only with permission)**

```bash
git add src/services/mailer.service.ts
git commit -m "refactor(email): mailer uses organizerInvite template"
```

---

### Task 4: Dev preview script + verification

**Files:**
- Create: `src/scripts/previewInviteEmail.ts`

- [ ] **Step 1: Create `src/scripts/previewInviteEmail.ts`**

```ts
import { writeFileSync } from 'node:fs'
import { renderOrganizerInvite } from '../emails/organizerInvite'

// Renders the invite email to a local HTML file so you can open it in a browser
// and eyeball the design. Run: npx tsx src/scripts/previewInviteEmail.ts
const { html } = renderOrganizerInvite({
  name: 'Javohir',
  link: 'https://camply.uz/invite/demo-token-123',
})
const out = 'invite-preview.html'
writeFileSync(out, html)
console.log(`✉️  Wrote ${out} — open it in a browser to preview.`)
```

- [ ] **Step 2: Run the preview and open it**

Run: `npx tsx src/scripts/previewInviteEmail.ts`
Expected: writes `invite-preview.html`. Open that file in a browser and confirm: green header, centered card, Amber "Taklifni qabul qilish" button, fallback link, footer. (The logo image will be a broken icon until assets are hosted — expected.)

- [ ] **Step 3: End-to-end preview via Ethereal (no SMTP creds needed)**

With `SMTP_HOST` unset in `.env`, trigger an organizer invite through the app (or the existing invite flow). The mailer logs an Ethereal preview URL — open it to confirm the same design renders as a real email.

- [ ] **Step 4: Add `invite-preview.html` to `.gitignore`**

Append `invite-preview.html` to `.gitignore` so the generated file is never committed.

- [ ] **Step 5: Commit (only with permission)**

```bash
git add src/scripts/previewInviteEmail.ts .gitignore
git commit -m "chore(email): add invite email preview script"
```

---

## Assets & hosting (user actions — not code)

These unblock the logo/GIF rendering in real inboxes:

- [ ] Produce a static logo PNG (can start from `camply-frontend/public/pwa-512x512.png`).
- [ ] Produce one small looping **GIF** accent (animated logo). Save both as `logo.gif` (and/or `logo.png`).
- [ ] Place them in `camply-frontend/public/email/` so they serve at `/email/logo.gif`.
- [ ] Deploy the frontend to a public URL (Vercel/Netlify). Set backend `APP_URL` (and, if using a separate host, `MAIL_ASSET_BASE_URL`) to that public origin so email images resolve.

## Follow-ups (out of scope, tracked)

- Make the invite email trilingual (EN/UZ/RU) per the project guardrail.
- If more transactional emails appear, revisit MJML/React Email.
