import { createHash, randomBytes } from 'node:crypto'
import type { HydratedDocument, Types } from 'mongoose'
import { SessionModel, type Session } from '../models/session.model'
import { USER_ROLES } from '../models/user.model'
import { env } from '../config/env'

type Role = (typeof USER_ROLES)[number]

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_HOUR = 60 * 60 * 1000

// The cookie carries the raw token; the DB stores only this hash.
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function newExpiry(): Date {
  return new Date(Date.now() + env.SESSION_TTL_DAYS * MS_PER_DAY)
}

export const sessionService = {
  // Create a session and return the RAW token to put in the cookie.
  create: async (userId: Types.ObjectId, role: Role, userAgent?: string): Promise<string> => {
    const rawToken = randomBytes(32).toString('base64url')
    await SessionModel.create({
      tokenHash: hashToken(rawToken),
      userId,
      role,
      expiresAt: newExpiry(),
      lastSeenAt: new Date(),
      userAgent,
    })
    return rawToken
  },

  // Find a non-expired session by the raw cookie value, or null.
  findLive: async (rawToken: string): Promise<HydratedDocument<Session> | null> => {
    const session = await SessionModel.findOne({ tokenHash: hashToken(rawToken) })
    if (!session) return null
    if (session.expiresAt.getTime() <= Date.now()) return null
    return session
  },

  // Sliding refresh: only writes when the session has gone stale, to avoid a DB
  // write on every request.
  refreshIfStale: async (session: HydratedDocument<Session>): Promise<void> => {
    const staleAfterMs = env.SESSION_REFRESH_THRESHOLD_HOURS * MS_PER_HOUR
    if (Date.now() - session.lastSeenAt.getTime() < staleAfterMs) return
    session.lastSeenAt = new Date()
    session.expiresAt = newExpiry()
    await session.save()
  },

  revoke: (rawToken: string) => SessionModel.deleteOne({ tokenHash: hashToken(rawToken) }),

  revokeAllForUser: (userId: Types.ObjectId) => SessionModel.deleteMany({ userId }),
}
