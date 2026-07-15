import path from 'node:path'

/*
  Organizer invite email. Pure: takes recipient name + magic link, returns the
  subject, an email-safe HTML body (table layout, inline styles — the only thing
  Gmail/Outlook render reliably), a plain-text fallback, and the header image as a
  CID attachment. The banner ships INSIDE every email (embedded, not linked), so it
  always renders with no public URL / hosting needed. No sending here.
*/

/** The header banner, referenced in the HTML as `cid:<INVITE_HEADER_CID>` and
 *  attached inline by the mailer. Lives in the repo → travels with every send. */
export const INVITE_HEADER_CID = 'camply-header'
export const INVITE_HEADER_PATH = path.join(__dirname, 'assets', 'camply-header.png')

type InviteAttachment = { filename: string; path: string; cid: string }

/** Escape the 5 HTML-significant chars so a recipient name can't break/inject markup. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderOrganizerInvite({ name, link }: { name: string; link: string }): {
  subject: string
  html: string
  text: string
  attachments: InviteAttachment[]
} {
  const safeName = escapeHtml(name)
  const subject = 'Camply — tashkilotchi taklifnomasi'

  const attachments: InviteAttachment[] = [
    { filename: 'camply-header.png', path: INVITE_HEADER_PATH, cid: INVITE_HEADER_CID },
  ]

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
          <td style="padding:0;font-size:0;line-height:0;">
            <img src="cid:${INVITE_HEADER_CID}" width="600" alt="Camply" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
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

  return { subject, html, text, attachments }
}
