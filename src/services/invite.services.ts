import { createHash, randomBytes } from 'node:crypto'
import type { Types } from 'mongoose'
import { InviteModel } from '../models/invite.model'
import { UserModel } from '../models/user.model'
import { HttpError } from '../middlewares/error.middleware'
import { sessionService } from './session.services'
import { toPublicUser, type PublicUser } from './auth.services'
import { env } from '../config/env'

const MS_PER_DAY = 24 * 60 * 60 * 1000
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export const inviteService = {
  /** Issue a fresh invite for a user, replacing any prior one. Returns the RAW token. */
  createInvite: async (userId: Types.ObjectId, email: string): Promise<string> => {
    await InviteModel.deleteMany({ userId })
    const rawToken = randomBytes(32).toString('base64url')
    await InviteModel.create({
      tokenHash: hashToken(rawToken),
      userId,
      email,
      expiresAt: new Date(Date.now() + env.INVITE_TTL_DAYS * MS_PER_DAY),
    })
    return rawToken
  },

  /** Public: what the accept screen shows. Throws 404 (invalid) / 410 (expired). */
  getPublicInvite: async (rawToken: string): Promise<{ name: string; email: string }> => {
    const invite = await InviteModel.findOne({ tokenHash: hashToken(rawToken) })
    if (!invite) throw new HttpError(404, 'Invalid invite')
    if (invite.expiresAt.getTime() <= Date.now()) throw new HttpError(410, 'Invite expired')
    const user = await UserModel.findById(invite.userId)
    if (!user) throw new HttpError(404, 'Invalid invite')
    return { name: user.name ?? '', email: invite.email }
  },

  /** Confirm the invite: mark accepted, activate, delete the token, start a session. */
  accept: async (
    rawToken: string,
    userAgent?: string,
  ): Promise<{ token: string; user: PublicUser }> => {
    const invite = await InviteModel.findOne({ tokenHash: hashToken(rawToken) })
    if (!invite) throw new HttpError(404, 'Invalid invite')
    if (invite.expiresAt.getTime() <= Date.now()) throw new HttpError(410, 'Invite expired')
    const user = await UserModel.findById(invite.userId)
    // Both organizers and managers onboard through this magic-link accept flow.
    if (!user || (user.role !== 'organizer' && user.role !== 'manager')) {
      throw new HttpError(404, 'Invalid invite')
    }

    // Phone was set by the org at invite time; accepting just confirms + activates.
    user.acceptedAt = new Date()
    user.active = true
    await user.save()
    await InviteModel.deleteMany({ userId: user._id })

    const token = await sessionService.create(user._id, user.role, userAgent)
    return { token, user: toPublicUser(user) }
  },
}
