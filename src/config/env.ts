import 'dotenv/config'
import { z } from 'zod'

// Validate env at boot so misconfiguration fails loudly & early,
// and the rest of the app gets a fully typed `env` object.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  console.error(z.treeifyError(parsed.error))
  process.exit(1)
}

export const env = parsed.data
