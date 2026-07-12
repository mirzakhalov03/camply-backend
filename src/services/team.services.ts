import type { HydratedDocument, Types } from 'mongoose'
import { MembershipModel, type Membership } from '../models/membership.model'
import { CampModel } from '../models/camp.model'
import { UserModel, type User } from '../models/user.model'
import { initialsOf, colorFor } from '../utils/avatar'
import { HttpError } from '../middlewares/error.middleware'

const createdAtOf = (m: Membership): string =>
  (m as unknown as { createdAt: Date }).createdAt.toISOString()

// The campIds the caller manages (organizer-tier memberships).
async function callerCampIds(userId: Types.ObjectId) {
  return MembershipModel.find({ userId, role: { $ne: 'participant' } }).distinct('campId')
}

export const teamService = {
  // The caller's team = organizer-tier memberships across the camps they manage.
  // active (userId bound) → members; pending (userId null) → outstanding invites.
  list: async (user: HydratedDocument<User>) => {
    const campIds = await callerCampIds(user._id)
    const rows = await MembershipModel.find({
      campId: { $in: campIds },
      role: { $ne: 'participant' },
    })

    const membersByUser = new Map<string, Membership>()
    const pending: Membership[] = []
    const seenPendingPhone = new Set<string>()
    for (const m of rows) {
      if (m.userId) {
        const key = String(m.userId)
        if (!membersByUser.has(key)) membersByUser.set(key, m)
      } else if (!seenPendingPhone.has(m.phone)) {
        seenPendingPhone.add(m.phone)
        pending.push(m)
      }
    }

    const members = await Promise.all(
      [...membersByUser.values()].map(async (m) => {
        const u = await UserModel.findById(m.userId)
        const name = u ? `${u.name} ${u.surname}`.trim() : m.phone
        return {
          id: String(m._id),
          name,
          initials: initialsOf(name),
          avatarColor: colorFor(String(m.userId)),
          photo: u?.photo ?? null,
          role: m.role,
          isMe: String(m.userId) === String(user._id),
        }
      }),
    )

    const org = await UserModel.findOne({ role: 'organization' }).select('name')
    return {
      organizationName: org?.name ?? '',
      members,
      pending: pending.map((m) => ({
        id: String(m._id),
        phone: m.phone,
        role: m.role,
        sentAt: createdAtOf(m),
      })),
    }
  },

  // Invite a teammate by phone + sub-role. The team is cross-camp but Membership is
  // camp-keyed, so the invite attaches to the caller's newest camp.
  // TODO(multi-camp): thread a real target camp / cross-camp team model when it lands.
  invite: async (user: HydratedDocument<User>, phone: string, role: string) => {
    const campIds = await callerCampIds(user._id)
    if (campIds.length === 0) throw new HttpError(409, 'Create a camp before inviting teammates')
    const camp = await CampModel.findOne({ _id: { $in: campIds } }).sort({ createdAt: -1 })
    if (!camp) throw new HttpError(409, 'Create a camp before inviting teammates')

    const existing = await MembershipModel.findOne({ campId: camp._id, phone })
    if (existing) throw new HttpError(409, 'This phone is already on the team')

    const m = await MembershipModel.create({
      campId: camp._id,
      phone,
      // Validated as one of the 7 sub-roles upstream (inviteTeamSchema).
      role: role as Membership['role'],
      status: 'pending',
      userId: null,
    })
    return { id: String(m._id), phone: m.phone, role: m.role, sentAt: createdAtOf(m) }
  },

  // Cancel a pending invite. Won't remove an active member (status guard).
  cancelInvite: async (id: string) => {
    const res = await MembershipModel.deleteOne({ _id: id, status: 'pending' })
    if (res.deletedCount === 0) throw new HttpError(404, 'Invite not found')
  },
}
