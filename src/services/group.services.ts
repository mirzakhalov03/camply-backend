import type { Types } from 'mongoose'
import { GroupModel, type Group } from '../models/group.model'
import { MembershipModel } from '../models/membership.model'
import { GroupPointsModel } from '../models/leaderboard.model'
import { UserModel } from '../models/user.model'
import { initialsOf, colorFor } from '../utils/avatar'
import { HttpError } from '../middlewares/error.middleware'

export async function toCampGroupDetail(group: Group) {
  const memberships = await MembershipModel.find({ groupId: group._id, role: 'participant' })
  const members = await Promise.all(
    memberships.map(async (m) => {
      const user = m.userId ? await UserModel.findById(m.userId) : null
      const name = user ? `${user.name} ${user.surname}`.trim() : m.phone
      return {
        id: String(m._id),
        name,
        initials: initialsOf(name),
        avatarColor: colorFor(String(m._id)),
        photo: user?.photo ?? null,
        isLeader: String(group.leaderMembershipId ?? '') === String(m._id),
      }
    }),
  )
  const leader = members.find((x) => x.isLeader)
  return {
    id: String(group._id),
    name: group.name,
    color: group.color,
    memberCount: members.length,
    leaderName: leader?.name ?? null,
    members,
  }
}

/*
  The PARTICIPANT's view of their OWN group.

  Deliberately NOT toCampGroupDetail: that projection returns each member's full
  name and membership id, and falls back to m.phone as the display name when a
  member has no bound user. Correct for the organizer's roster; a privacy leak in
  a card every group member can see. Here: initials and a palette token, nothing else.

  Two different color conventions ship here, deliberately:
    - members[].color is a palette TOKEN ('pine' | 'amber' | 'sky' | 'deep') from
      colorFor(), which the client resolves to var(--color-<token>) so the avatar
      tiles follow dark mode.
    - group.color is whatever the organizer picked, which in existing data is a
      raw HEX string despite group.model.ts calling it a token.
  The client's paletteColor() therefore passes non-token values through unchanged
  rather than forcing them into the palette.
*/
export async function toMyGroup(group: Group) {
  const memberships = await MembershipModel.find({
    groupId: group._id,
    role: 'participant',
  }).select('_id userId')

  const members = await Promise.all(
    memberships.map(async (m) => {
      const user = m.userId ? await UserModel.findById(m.userId).select('name surname') : null
      // name/surname stay optional until completeProfile, so a claimed participant
      // can be nameless. Never fall back to the phone — this list is group-visible.
      const label = user ? `${user.name ?? ''} ${user.surname ?? ''}`.trim() : ''
      return {
        initials: label ? initialsOf(label) : '?',
        color: colorFor(String(m._id)),
      }
    }),
  )

  return {
    id: String(group._id),
    name: group.name,
    color: group.color,
    photo: group.photo ?? null,
    memberCount: members.length,
    members,
  }
}

export const groupService = {
  list: async (campId: Types.ObjectId) => {
    const groups = await GroupModel.find({ campId }).sort({ createdAt: 1 })
    return Promise.all(groups.map(toCampGroupDetail))
  },
  create: async (campId: Types.ObjectId, input: { name: string; color: string }) => {
    const group = await GroupModel.create({ campId, ...input })
    // Seed its leaderboard row so standings include the group from day one.
    await GroupPointsModel.create({ campId, groupId: group._id })
    return toCampGroupDetail(group)
  },
  update: async (gid: string, patch: Record<string, unknown>) => {
    const g = await GroupModel.findByIdAndUpdate(gid, { $set: patch }, { new: true })
    if (!g) throw new HttpError(404, 'Group not found')
    return toCampGroupDetail(g)
  },
  remove: async (gid: string) => {
    await MembershipModel.updateMany({ groupId: gid }, { $set: { groupId: null } })
    await GroupPointsModel.deleteOne({ groupId: gid })
    const res = await GroupModel.deleteOne({ _id: gid })
    if (res.deletedCount === 0) throw new HttpError(404, 'Group not found')
  },
}
