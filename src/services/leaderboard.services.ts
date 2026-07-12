import type { Types } from 'mongoose'
import { GroupPointsModel, PointEventModel } from '../models/leaderboard.model'
import { GroupModel } from '../models/group.model'
import { MembershipModel } from '../models/membership.model'
import { HttpError } from '../middlewares/error.middleware'

type Category = 'activities' | 'attendance' | 'challenges'

export const leaderboardService = {
  get: async (campId: Types.ObjectId, callerUserId: Types.ObjectId) => {
    const [rows, groups] = await Promise.all([
      GroupPointsModel.find({ campId }),
      GroupModel.find({ campId }),
    ])
    const byGroup = new Map(rows.map((r) => [String(r.groupId), r]))
    const callerMembership = await MembershipModel.findOne({ campId, userId: callerUserId })
    const currentGroupId = callerMembership?.groupId ? String(callerMembership.groupId) : null

    return {
      periodLabel: 'Week 1', // period selector is a later feature; label is contract-required
      currentGroupId,
      groups: groups.map((g) => {
        const p = byGroup.get(String(g._id))
        const activities = p?.activities ?? 0
        const attendance = p?.attendance ?? 0
        const challenges = p?.challenges ?? 0
        return {
          id: String(g._id),
          name: g.name,
          color: g.color,
          photo: g.photo ?? undefined,
          score: activities + attendance + challenges,
          previousScore: p?.previousScore ?? 0,
          breakdown: { activities, attendance, challenges },
        }
      }),
    }
  },

  adjust: async (
    campId: Types.ObjectId,
    gid: string,
    delta: number,
    category: Category,
    byUserId: Types.ObjectId,
  ) => {
    const row = await GroupPointsModel.findOne({ campId, groupId: gid })
    if (!row) throw new HttpError(404, 'Group has no leaderboard row')
    await GroupPointsModel.updateOne({ _id: row._id }, { $inc: { [category]: delta } })
    await PointEventModel.create({ campId, groupId: gid, category, delta, byUserId })
  },
}
