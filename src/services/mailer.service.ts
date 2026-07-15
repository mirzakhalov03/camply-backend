import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../config/env'
import { renderOrganizerInvite } from '../emails/organizerInvite'

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
    const { subject, html, text, attachments } = renderOrganizerInvite({ name, link })
    const info = await transport.sendMail({
      from: env.MAIL_FROM,
      to,
      subject,
      text,
      html,
      attachments,
    })
    const previewUrl = nodemailer.getTestMessageUrl(info) || undefined
    if (previewUrl) console.log('✉️  Invite email preview:', previewUrl)
    return { previewUrl }
  },
}
