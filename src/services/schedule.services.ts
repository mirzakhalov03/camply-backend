import type { Types } from 'mongoose'
import { ActivityModel, type Activity as ActivityDoc } from '../models/activity.model'
import { GroupModel } from '../models/group.model'
import { PlaceModel } from '../models/place.model'
import { HttpError } from '../middlewares/error.middleware'

type Scope = { kind: 'camp' } | { kind: 'group'; groupId: string; groupName: string }

/** The resolved place, so a client can render an icon + deep-link without a second call. */
type PlaceRef = { id: string; name: string; icon: string } | null

/*
  Prefetched lookups, so a LIST doesn't run one query per row. The DB is remote
  (~180ms per round trip — see the chat membersFrom lesson), so a per-row findById in
  a 40-activity schedule is seconds of pure latency. Absent for single-document
  callers, which then resolve their own one row.
*/
type Lookups = {
  groupNames: Map<string, string>
  places: Map<string, PlaceRef>
}

async function toActivity(a: ActivityDoc, lookups?: Lookups) {
  let scope: Scope = { kind: 'camp' }
  if (a.scope === 'group' && a.groupId) {
    const gid = String(a.groupId)
    const name = lookups
      ? (lookups.groupNames.get(gid) ?? '')
      : ((await GroupModel.findById(gid).select('name'))?.name ?? '')
    scope = { kind: 'group', groupId: gid, groupName: name }
  }

  let place: PlaceRef = null
  if (a.placeId) {
    const pid = String(a.placeId)
    if (lookups) {
      place = lookups.places.get(pid) ?? null
    } else {
      const doc = await PlaceModel.findById(pid).select('name icon')
      place = doc ? { id: pid, name: doc.name, icon: doc.icon } : null
    }
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
    placeId: a.placeId ? String(a.placeId) : null,
    place,
  }
}

/** One query per collection for the whole list, never one per row. */
async function lookupsFor(items: ActivityDoc[]): Promise<Lookups> {
  const groupIds = [...new Set(items.filter((a) => a.groupId).map((a) => String(a.groupId)))]
  const placeIds = [...new Set(items.filter((a) => a.placeId).map((a) => String(a.placeId)))]

  const [groups, places] = await Promise.all([
    groupIds.length
      ? GroupModel.find({ _id: { $in: groupIds } })
          .select('name')
          .lean()
      : [],
    placeIds.length
      ? PlaceModel.find({ _id: { $in: placeIds } })
          .select('name icon')
          .lean()
      : [],
  ])

  return {
    groupNames: new Map(groups.map((g) => [String(g._id), g.name])),
    places: new Map(
      places.map((p) => [String(p._id), { id: String(p._id), name: p.name, icon: p.icon }]),
    ),
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
  placeId?: string | null
}

export const scheduleService = {
  list: async (campId: Types.ObjectId) => {
    const items = await ActivityModel.find({ campId }).sort({ startsAt: 1 })
    const lookups = await lookupsFor(items)
    return Promise.all(items.map((a) => toActivity(a, lookups)))
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
      placeId: input.placeId ?? null,
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
