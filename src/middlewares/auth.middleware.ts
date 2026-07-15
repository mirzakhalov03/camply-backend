import type { RequestHandler } from 'express'
import { UserModel, USER_ROLES } from '../models/user.model'
import { sessionService } from '../services/session.services'
import { HttpError } from './error.middleware'
import { SESSION_COOKIE_NAME } from '../config/cookies'

type Role = (typeof USER_ROLES)[number]

// Higher rank = more authority. requireRole(min) passes when rank >= RANK[min].
const RANK: Record<Role, number> = { participant: 1, organizer: 2, manager: 3, organization: 4 }

// AUTHENTICATION — "who are you?". Reads the session cookie, loads the user,
// attaches req.auth. Throws 401 on any failure. (Express 5 forwards async throws.)
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined
  if (!rawToken) throw new HttpError(401, 'Not authenticated')

  const session = await sessionService.findLive(rawToken)
  if (!session) throw new HttpError(401, 'Session expired')

  const user = await UserModel.findById(session.userId)
  if (!user) throw new HttpError(401, 'Not authenticated')
  // A just-deactivated organizer must not ride an existing session.
  if (!user.active) throw new HttpError(401, 'Account deactivated')

  await sessionService.refreshIfStale(session)
  req.auth = { user, session }
  next()
}

// AUTHORIZATION — "what may you do?". Compose AFTER requireAuth.
export const requireRole =
  (min: Role): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) throw new HttpError(401, 'Not authenticated')
    if (RANK[req.auth.user.role] < RANK[min]) {
      throw new HttpError(403, 'Insufficient permissions')
    }
    next()
  }
