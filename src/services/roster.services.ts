import type { Types } from 'mongoose'
import { MembershipModel, type Membership } from '../models/membership.model'
import { UserModel } from '../models/user.model'
import { GroupModel } from '../models/group.model'
import { membershipService } from './membership.services'
import { initialsOf, colorFor } from '../utils/avatar'
import { canonicalizePhone } from '../utils/phone'
import { HttpError } from '../middlewares/error.middleware'

export async function toRosterParticipant(m: Membership) {
  const [user, group] = await Promise.all([
    m.userId ? UserModel.findById(m.userId) : null,
    m.groupId ? GroupModel.findById(m.groupId) : null,
  ])
  const name = user ? `${user.name} ${user.surname}`.trim() : ''
  return {
    id: String(m._id),
    /*
      The bound USER id, distinct from `id` (the membership). The live map keys pins
      by userId, so "See on map" needs this to have anything to aim at. Null for a
      pending invite — who by definition has never reported a position, which is
      exactly the case the map's "no location yet" notice covers.
    */
    userId: m.userId ? String(m.userId) : null,
    name,
    initials: initialsOf(name || m.phone),
    avatarColor: colorFor(String(m._id)),
    photo: user?.photo ?? null,
    groupId: group ? String(group._id) : null,
    groupName: group?.name ?? null,
    city: user?.cityId ?? '',
    age: user?.age ?? 0,
    phone: m.phone,
  }
}

export const rosterService = {
  list: async (campId: Types.ObjectId) => {
    const members = await MembershipModel.find({ campId, role: 'participant' })
    const rows = await Promise.all(members.map(toRosterParticipant))
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  },

  add: async (campId: Types.ObjectId, phoneRaw: string, groupId?: string | null) => {
    // Canonicalize to the SAME +998… form login uses, or claim-on-login
    // (authService.login) and bindPhone would never match this membership.
    const phone = canonicalizePhone(phoneRaw)
    if ((await membershipService.countParticipantCamps(phone)) >= 2) {
      throw new HttpError(409, 'This phone is already in 2 camps')
    }
    const existingUser = await UserModel.findOne({ phone })
    try {
      const m = await MembershipModel.create({
        campId,
        phone,
        groupId: groupId ?? null,
        role: 'participant',
        userId: existingUser?._id ?? null,
        status: existingUser ? 'active' : 'pending',
      })
      return toRosterParticipant(m)
    } catch (err) {
      // {campId, phone} is unique — a repeat add for this camp is a clean 409,
      // not a 500. Anything else is a real failure; rethrow it.
      if (err && typeof err === 'object' && 'code' in err && err.code === 11000) {
        throw new HttpError(409, 'This phone is already in this camp')
      }
      throw err
    }
  },

  update: async (mid: string, patch: { groupId?: string | null; role?: string }) => {
    const m = await MembershipModel.findByIdAndUpdate(mid, { $set: patch }, { new: true })
    if (!m) throw new HttpError(404, 'Membership not found')
    return toRosterParticipant(m)
  },

  remove: async (mid: string) => {
    const res = await MembershipModel.deleteOne({ _id: mid })
    if (res.deletedCount === 0) throw new HttpError(404, 'Membership not found')
  },
}
