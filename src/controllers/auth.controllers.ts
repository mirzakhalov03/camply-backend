import type { RequestHandler } from 'express'
import { authService } from '../services/auth.services'
import { sessionService } from '../services/session.services'
import { SESSION_COOKIE_NAME, setCookieOptions, clearCookieOptions } from '../config/cookies'

export const register: RequestHandler = async (req, res) => {
  const { token, user } = await authService.register(req.body, req.get('user-agent'))
  res.cookie(SESSION_COOKIE_NAME, token, setCookieOptions())
  res.status(201).json({ user })
}

export const login: RequestHandler = async (req, res) => {
  const { token, user } = await authService.login(req.body, req.get('user-agent'))
  res.cookie(SESSION_COOKIE_NAME, token, setCookieOptions())
  res.json({ user })
}

// req.auth is guaranteed by requireAuth on this route.
export const me: RequestHandler = async (req, res) => {
  const user = req.auth!.user
  res.json({
    id: String(user._id),
    phone: user.phone,
    name: user.name,
    surname: user.surname,
    role: user.role,
  })
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

export const createOrganizer: RequestHandler = async (req, res) => {
  const user = await authService.createOrganizer(req.body)
  res.status(201).json({ user })
}
