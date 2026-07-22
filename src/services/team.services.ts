import type { HydratedDocument, Types } from 'mongoose'
import { MembershipModel, type Membership } from '../models/membership.model'
import { CampModel } from '../models/camp.model'
import { GroupModel } from '../models/group.model'
import { UserModel, type User } from '../models/user.model'
import { initialsOf, colorFor } from '../utils/avatar'
import { HttpError } from '../middlewares/error.middleware'

const createdAtOf = (m: Membership): string =>
  (m as unknown as { createdAt: Date }).createdAt.toISOString()

// The campIds the caller manages (organizer-tier memberships).
async function callerCampIds(userId: Types.ObjectId) {
  return MembershipModel.find({ userId, role: { $ne: 'participant' } }).distinct('campId')
}

// Resolve a groupId against a specific camp: it must exist AND belong to that camp,
// or a coordinator could be pointed at another camp's group. Returns the ObjectId.
async function resolveCampGroup(campId: Types.ObjectId, groupId: string): Promise<Types.ObjectId> {
  const group = await GroupModel.findOne({ _id: groupId, campId })
  if (!group) throw new HttpError(400, 'Group not found in this camp')
  return group._id
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
          // The manager's own team roster — they need a way to actually reach these
          // people. Mirrors the `pending` rows below, which already carry the phone.
          phone: m.phone,
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
  invite: async (user: HydratedDocument<User>, phone: string, role: string, groupId?: string) => {
    const campIds = await callerCampIds(user._id)
    if (campIds.length === 0) throw new HttpError(409, 'Create a camp before inviting teammates')
    const camp = await CampModel.findOne({ _id: { $in: campIds } }).sort({ createdAt: -1 })
    if (!camp) throw new HttpError(409, 'Create a camp before inviting teammates')

    // A group may only be attached to a coordinator, and only within THIS camp.
    let resolvedGroupId: Types.ObjectId | null = null
    if (groupId) {
      if (role !== 'coordinator') {
        throw new HttpError(400, 'Only a coordinator can be assigned a group')
      }
      resolvedGroupId = await resolveCampGroup(camp._id, groupId)
    }

    const existing = await MembershipModel.findOne({ campId: camp._id, phone })
    if (existing) throw new HttpError(409, 'This phone is already on the team')

    /*
      A manager runs exactly ONE camp — and that has to be enforced on ASSIGNMENT,
      not just creation. campService.createFull caps managers by counting camps
      they created, which stops a second `POST /organizer/camps` but says nothing
      about being invited elsewhere. And requireCampManager grants manager-tier
      rights on the strength of the ACCOUNT role alone, so a manager who joined
      another camp's team would silently hold full control of a camp they don't own.
    */
    const invitee = await UserModel.findOne({ phone }).select('role')
    if (invitee?.role === 'manager') {
      throw new HttpError(409, 'Managers run their own camp and cannot join another camp’s team')
    }

    const m = await MembershipModel.create({
      campId: camp._id,
      phone,
      // Validated as one of the 6 sub-roles upstream (inviteTeamSchema).
      role: role as Membership['role'],
      status: 'pending',
      userId: null,
      groupId: resolvedGroupId,
    })
    return { id: String(m._id), phone: m.phone, role: m.role, sentAt: createdAtOf(m) }
  },

  // Reassign or clear a coordinator's group (handoff / group dissolved). Manager-gated
  // at the route. 400 if the target isn't a coordinator row.
  setCoordinatorGroup: async (membershipId: string, groupId: string | null) => {
    const m = await MembershipModel.findById(membershipId)
    if (!m) throw new HttpError(404, 'Membership not found')
    if (m.role !== 'coordinator') {
      throw new HttpError(400, 'Only a coordinator has a chat group')
    }
    m.groupId = groupId ? await resolveCampGroup(m.campId as Types.ObjectId, groupId) : null
    await m.save()
    return { id: String(m._id), groupId: m.groupId ? String(m.groupId) : null, role: m.role }
  },

  // Cancel a pending invite. Won't remove an active member (status guard).
  cancelInvite: async (id: string) => {
    const res = await MembershipModel.deleteOne({ _id: id, status: 'pending' })
    if (res.deletedCount === 0) throw new HttpError(404, 'Invite not found')
  },
}
