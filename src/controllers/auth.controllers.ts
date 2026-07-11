import type { RequestHandler } from 'express'
import { authService, toPublicUser } from '../services/auth.services'
import { sessionService } from '../services/session.services'
import { SESSION_COOKIE_NAME, setCookieOptions, clearCookieOptions } from '../config/cookies'

export const login: RequestHandler = async (req, res) => {
  const { token, user } = await authService.login(req.body, req.get('user-agent'))
  res.cookie(SESSION_COOKIE_NAME, token, setCookieOptions())
  res.json({ user })
}

// req.auth is guaranteed by requireAuth on this route.
export const me: RequestHandler = async (req, res) => {
  res.json(toPublicUser(req.auth!.user))
}

export const logout: RequestHandler = async (req, res) => {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined
  if (rawToken) await sessionService.revoke(rawToken)
  res.clearCookie(SESSION_COOKIE_NAME, clearCookieOptions())
  res.status(204).end()
}

export const logoutAll: RequestHandler = async (req, res) => {
  await sessionService.revokeAllForUser(req.auth!.user._id)
  res.clearCookie(SESSION_COOKIE_NAME, clearCookieOptions())
  res.status(204).end()
}

export const completeProfile: RequestHandler = async (req, res) => {
  const user = await authService.completeProfile(req.auth!.user, req.body)
  res.json(user)
}
