import type { HydratedDocument } from 'mongoose'
import { UserModel, type User } from '../models/user.model'
import { InviteModel } from '../models/invite.model'
import { HttpError } from '../middlewares/error.middleware'
import { sessionService } from './session.services'
import { inviteService } from './invite.services'
import { mailer } from './mailer.service'
import { env } from '../config/env'
import type { CreateOrganizerInput } from '../validators/organizer.validators'

export type OrganizerStatus = 'pending' | 'active' | 'deactivated'

export type PublicOrganizer = {
  id: string
  email: string | null
  phone: string | null
  name: string
  surname: string
  status: OrganizerStatus
  createdAt: string
}

function statusOf(user: HydratedDocument<User>): OrganizerStatus {
  if (!user.phone) return 'pending' // invited, not yet accepted
  return user.active ? 'active' : 'deactivated'
}

function toPublicOrganizer(user: HydratedDocument<User>): PublicOrganizer {
  return {
    id: String(user._id),
    email: user.email ?? null,
    phone: user.phone ?? null,
    name: user.name ?? '',
    surname: user.surname ?? '',
    status: statusOf(user),
    createdAt: (user as unknown as { createdAt: Date }).createdAt.toISOString(),
  }
}

export const organizerService = {
  list: async (): Promise<PublicOrganizer[]> => {
    const users = await UserModel.find({ role: 'organizer' }).sort({ createdAt: -1 })
    return users.map(toPublicOrganizer)
  },

  /** Create a PENDING organizer (email only) and email them an invite link. */
  create: async (
    input: CreateOrganizerInput,
  ): Promise<{ organizer: PublicOrganizer; inviteUrl?: string }> => {
    const email = input.email.toLowerCase()
    const exists = await UserModel.exists({ email })
    if (exists) throw new HttpError(409, 'Email already registered')

    const user = await UserModel.create({
      email,
      name: input.name,
      surname: input.surname,
      role: 'organizer',
      active: true, // active flag ≠ accepted; status is 'pending' until phone is set
    })

    const rawToken = await inviteService.createInvite(user._id, email)
    const inviteUrl = `${env.APP_URL}/invite/${rawToken}`
    await mailer.sendOrganizerInvite({ to: email, name: user.name ?? '', link: inviteUrl })

    // Expose the link in dev only, so the org can test without a real inbox.
    return {
      organizer: toPublicOrganizer(user),
      ...(env.NODE_ENV !== 'production' ? { inviteUrl } : {}),
    }
  },

  /** Re-issue + resend an invite. Pending organizers only. */
  resendInvite: async (id: string): Promise<{ organizer: PublicOrganizer; inviteUrl?: string }> => {
    const user = await UserModel.findOne({ _id: id, role: 'organizer' })
    if (!user) throw new HttpError(404, 'Organizer not found')
    if (user.phone) throw new HttpError(409, 'Organizer already active')
    const email = user.email ?? ''
    const rawToken = await inviteService.createInvite(user._id, email)
    const inviteUrl = `${env.APP_URL}/invite/${rawToken}`
    await mailer.sendOrganizerInvite({ to: email, name: user.name ?? '', link: inviteUrl })
    return {
      organizer: toPublicOrganizer(user),
      ...(env.NODE_ENV !== 'production' ? { inviteUrl } : {}),
    }
  },

  /** Revoke a PENDING invite: delete the stub user + token. Pending only. */
  revokeInvite: async (id: string): Promise<void> => {
    const user = await UserModel.findOne({ _id: id, role: 'organizer' })
    if (!user) throw new HttpError(404, 'Organizer not found')
    if (user.phone) throw new HttpError(409, 'Organizer already active — deactivate instead')
    await InviteModel.deleteMany({ userId: user._id })
    await UserModel.deleteOne({ _id: user._id })
  },

  setActive: async (id: string, active: boolean): Promise<PublicOrganizer> => {
    const user = await UserModel.findOne({ _id: id, role: 'organizer' })
    if (!user) throw new HttpError(404, 'Organizer not found')
    user.active = active
    await user.save()
    if (!active) await sessionService.revokeAllForUser(user._id)
    return toPublicOrganizer(user)
  },
}
