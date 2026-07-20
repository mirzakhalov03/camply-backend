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
  // S3 image uploads. OPTIONAL so the app boots before credentials are provisioned —
  // the presign route returns 503 instead. Validated as a GROUP below: a
  // half-configured bucket is worse than an unconfigured one, because it fails at
  // upload time instead of at boot.
  AWS_REGION: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  // CDN/base URL objects are served from. Without it, only the key is returned.
  S3_PUBLIC_BASE_URL: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  console.error(z.treeifyError(parsed.error))
  process.exit(1)
}

// All-or-nothing S3: partial credentials would boot fine and then fail on the first
// upload, which is a much worse place to discover the misconfiguration.
const S3_VARS = [
  'AWS_REGION',
  'AWS_S3_BUCKET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const
const s3Set = S3_VARS.filter((key) => parsed.data[key])
if (s3Set.length > 0 && s3Set.length < S3_VARS.length) {
  console.error('❌ Partial S3 configuration. Set all of:', S3_VARS.join(', '))
  console.error('   Currently set:', s3Set.join(', ') || '(none)')
  process.exit(1)
}

export const env = parsed.data
