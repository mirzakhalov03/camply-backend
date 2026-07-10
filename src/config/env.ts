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
  SEED_ORG_PHONE: z.string().optional(),
  SEED_ORG_PASSWORD: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  console.error(z.treeifyError(parsed.error))
  process.exit(1)
}

export const env = parsed.data
