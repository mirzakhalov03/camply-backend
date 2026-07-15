import type { HydratedDocument } from 'mongoose'
import { UserModel, type User } from '../models/user.model'
import { InviteModel } from '../models/invite.model'
import { MembershipModel, MEMBERSHIP_ROLES } from '../models/membership.model'
import { HttpError } from '../middlewares/error.middleware'
import { sessionService } from './session.services'
import { inviteService } from './invite.services'
import { mailer } from './mailer.service'
import { canonicalizePhone } from '../utils/phone'
import { env } from '../config/env'

export type OnboardingStatus = 'pending' | 'active' | 'deactivated'

export type PublicOnboardingUser = {
  id: string
  email: string | null
  phone: string | null
  name: string
  surname: string
  status: OnboardingStatus
  createdAt: string
}

export type OnboardingCreateInput = {
  name: string
  surname: string
  email: string
  phone: string
}

export type InviteActionResult = { user: PublicOnboardingUser; inviteUrl?: string }

type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]

function statusOf(user: HydratedDocument<User>): OnboardingStatus {
  if (!user.acceptedAt) return 'pending' // invited, not yet accepted
  return user.active ? 'active' : 'deactivated'
}

function toPublic(user: HydratedDocument<User>): PublicOnboardingUser {
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

/**
 * Build an invite-onboarding service for an account `role`. Organizers and managers
 * share every step (invite token, email, status derivation, deactivation) except the
 * role stamped/queried and which membership roles are purged on delete. The two
 * domains (`organizer.services`, `managers.services`) are thin instances of this.
 */
export function makeOnboardingService(opts: {
  role: 'organizer' | 'manager'
  /** Membership roles to purge when the account is deleted. */
  cleanupMembershipRoles: readonly MembershipRole[]
}) {
  const { role, cleanupMembershipRoles } = opts
  const label = role === 'manager' ? 'Manager' : 'Organizer'

  async function sendInvite(user: HydratedDocument<User>): Promise<string> {
    const email = user.email ?? ''
    const rawToken = await inviteService.createInvite(user._id, email)
    const inviteUrl = `${env.APP_URL}/invite/${rawToken}`
    await mailer.sendOrganizerInvite({ to: email, name: user.name ?? '', link: inviteUrl })
    return inviteUrl
  }

  function withDevUrl(user: HydratedDocument<User>, inviteUrl: string): InviteActionResult {
    // Expose the link in dev only, so the org/manager can test without a real inbox.
    return {
      user: toPublic(user),
      ...(env.NODE_ENV !== 'production' ? { inviteUrl } : {}),
    }
  }

  return {
    list: async (): Promise<PublicOnboardingUser[]> => {
      const users = await UserModel.find({ role }).sort({ createdAt: -1 })
      return users.map(toPublic)
    },

    /** Create a PENDING account (email only) and email an invite link. */
    create: async (input: OnboardingCreateInput): Promise<InviteActionResult> => {
      const email = input.email.toLowerCase()
      if (await UserModel.exists({ email })) throw new HttpError(409, 'Email already registered')

      const phone = canonicalizePhone(input.phone)
      if (await UserModel.exists({ phone })) throw new HttpError(409, 'Phone already registered')

      const user = await UserModel.create({
        email,
        phone,
        name: input.name,
        surname: input.surname,
        role,
        active: true, // active flag ≠ accepted; status is 'pending' until acceptedAt is set
      })
      return withDevUrl(user, await sendInvite(user))
    },

    /** Re-issue + resend an invite. Pending accounts only. */
    resendInvite: async (id: string): Promise<InviteActionResult> => {
      const user = await UserModel.findOne({ _id: id, role })
      if (!user) throw new HttpError(404, `${label} not found`)
      if (user.acceptedAt) throw new HttpError(409, `${label} already active`)
      return withDevUrl(user, await sendInvite(user))
    },

    /**
     * Delete an account — two-step safety for accepted ones:
     *  • pending (never accepted)             → cancel the invite (delete the stub).
     *  • deactivated (accepted, active=false) → hard delete.
     * An accepted + still-active account is rejected (409): deactivate first. Camps are
     * org-owned and left intact — only the account's own footprint is removed (invite
     * tokens + its own memberships + sessions).
     */
    remove: async (id: string): Promise<void> => {
      const user = await UserModel.findOne({ _id: id, role })
      if (!user) throw new HttpError(404, `${label} not found`)
      if (user.acceptedAt && user.active) {
        throw new HttpError(409, `Deactivate the ${label.toLowerCase()} before deleting`)
      }
      await InviteModel.deleteMany({ userId: user._id })
      await MembershipModel.deleteMany({
        userId: user._id,
        role: { $in: [...cleanupMembershipRoles] },
      })
      await sessionService.revokeAllForUser(user._id)
      await UserModel.deleteOne({ _id: user._id })
    },

    setActive: async (id: string, active: boolean): Promise<PublicOnboardingUser> => {
      const user = await UserModel.findOne({ _id: id, role })
      if (!user) throw new HttpError(404, `${label} not found`)
      user.active = active
      await user.save()
      if (!active) await sessionService.revokeAllForUser(user._id)
      return toPublic(user)
    },
  }
}
