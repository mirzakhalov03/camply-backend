import { env } from './env'

// One source of truth for the session cookie, so set + clear never drift.
export const SESSION_COOKIE_NAME = 'camply_sid'

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Shared attributes. `Secure` only in production so http://localhost works in dev.
// SameSite=Lax fits a same-origin PWA (dev goes through Vite's /api proxy).
const baseOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}

// For res.cookie(...) — includes Max-Age.
export const setCookieOptions = () => ({
  ...baseOptions,
  maxAge: env.SESSION_TTL_DAYS * MS_PER_DAY,
})

// For res.clearCookie(...) — MUST match baseOptions (no Max-Age) or the browser
// won't clear it.
export const clearCookieOptions = () => baseOptions
