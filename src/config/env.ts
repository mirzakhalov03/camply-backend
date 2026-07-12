import 'dotenv/config'
import { z } from 'zod'

// Validate env at boot so misconfiguration fails loudly & early,
// and the rest of the app gets a fully typed `env` object.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  // Session lifetime (cookie Max-Age + sessions.expiresAt), in days.
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  // How stale a session may get before an authenticated request slides it forward.
  SESSION_REFRESH_THRESHOLD_HOURS: z.coerce.number().default(24),
  // Used ONLY by `npm run seed:org` to provision the first organization.
  // The org logs in by username (not phone); dev defaults are admin / 1234.
  SEED_ORG_USERNAME: z.string().min(1).default('admin'),
  SEED_ORG_PASSWORD: z.string().min(1).default('1234'),
  // Invite emails (organizer onboarding). APP_URL is the frontend base for the
  // magic link. SMTP_* optional — if unset, dev uses a nodemailer Ethereal test
  // account (preview URL logged; no real delivery).
  APP_URL: z.string().default('http://localhost:5173'),
  MAIL_FROM: z.string().default('Camply <no-reply@camply.dev>'),
  INVITE_TTL_DAYS: z.coerce.number().default(7),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  console.error(z.treeifyError(parsed.error))
  process.exit(1)
}

export const env = parsed.data
