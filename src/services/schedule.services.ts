import type { Types } from 'mongoose'
import { ActivityModel, type Activity as ActivityDoc } from '../models/activity.model'
import { GroupModel } from '../models/group.model'
import { HttpError } from '../middlewares/error.middleware'

type Scope = { kind: 'camp' } | { kind: 'group'; groupId: string; groupName: string }

async function toActivity(a: ActivityDoc) {
  let scope: Scope = { kind: 'camp' }
  if (a.scope === 'group' && a.groupId) {
    const g = await GroupModel.findById(a.groupId)
    scope = { kind: 'group', groupId: String(a.groupId), groupName: g?.name ?? '' }
  }
  return {
    id: String(a._id),
    campId: String(a.campId),
    title: a.title,
    location: a.location,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    scope,
    description: a.description ?? null,
  }
}

type NewActivity = {
  campId: string
  title: string
  location: string
  startsAt: string
  endsAt: string
  scope: Scope
  description?: string | null
}

export const scheduleService = {
  list: async (campId: Types.ObjectId) => {
    const items = await ActivityModel.find({ campId }).sort({ startsAt: 1 })
    return Promise.all(items.map(toActivity))
  },
  create: async (campId: Types.ObjectId, input: NewActivity) => {
    const doc = await ActivityModel.create({
      campId,
      title: input.title,
      location: input.location,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      scope: input.scope.kind,
      groupId: input.scope.kind === 'group' ? input.scope.groupId : null,
      description: input.description ?? null,
    })
    return toActivity(doc)
  },
  update: async (aid: string, patch: Partial<NewActivity>) => {
    const set: Record<string, unknown> = { ...patch }
    if (patch.startsAt) set.startsAt = new Date(patch.startsAt)
    if (patch.endsAt) set.endsAt = new Date(patch.endsAt)
    if (patch.scope) {
      set.scope = patch.scope.kind
      set.groupId = patch.scope.kind === 'group' ? patch.scope.groupId : null
    }
    const doc = await ActivityModel.findByIdAndUpdate(aid, { $set: set }, { new: true })
    if (!doc) throw new HttpError(404, 'Activity not found')
    return toActivity(doc)
  },
  remove: async (aid: string) => {
    const res = await ActivityModel.deleteOne({ _id: aid })
    if (res.deletedCount === 0) throw new HttpError(404, 'Activity not found')
  },
}
