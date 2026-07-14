import type { RequestHandler } from 'express'
import { inviteService } from '../services/invite.services'
import { SESSION_COOKIE_NAME, setCookieOptions } from '../config/cookies'

export const getInvite: RequestHandler = async (req, res) => {
  const invite = await inviteService.getPublicInvite(String(req.params.token))
  res.json(invite) // { name, email }
}

export const acceptInvite: RequestHandler = async (req, res) => {
  const { token, user } = await inviteService.accept(
    String(req.params.token),
    req.get('user-agent'),
  )
  res.cookie(SESSION_COOKIE_NAME, token, setCookieOptions())
  res.json({ user })
}
