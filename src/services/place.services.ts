import type { Types } from 'mongoose'
import { PlaceModel, type Place } from '../models/place.model'
import { CampModel } from '../models/camp.model'
import { HttpError } from '../middlewares/error.middleware'

/** The wire shape. Same projection for every role — a place carries no private data. */
export function toPlace(p: Place) {
  return {
    id: String(p._id),
    kind: p.kind,
    name: p.name,
    icon: p.icon,
    shape: p.shape,
    center: { lat: p.center.lat, lon: p.center.lon },
    radiusM: p.radiusM ?? null,
    order: p.order ?? 0,
  }
}

/*
  A zone is an AREA and owns a radius; a landmark is a POINT and must not.

  This lives in the service rather than a Zod `superRefine` because the UPDATE path
  never carries `kind` in its body (kind is immutable — see place.validators), so the
  STORED kind is the only source of truth for the rule. Putting it here gives both
  write paths one implementation instead of one each.
*/
export function assertKindRadius(kind: Place['kind'], radiusM: number | null) {
  if (kind === 'zone' && radiusM == null) {
    throw new HttpError(400, 'A zone needs a radius')
  }
  if (kind === 'landmark' && radiusM != null) {
    throw new HttpError(400, 'A landmark cannot have a radius')
  }
}

type CreateInput = {
  kind: Place['kind']
  name: string
  icon: string
  center: { lat: number; lon: number }
  radiusM?: number | null
  order?: number
}

export const placeService = {
  /*
    Everything the map needs to draw its static layer: the camp's boundary plus its
    places. Member-level — a place is camp-wide public, so the manager reads the same
    endpoint rather than a duplicate authoring one.
  */
  listForCamp: async (campId: Types.ObjectId) => {
    const [camp, places] = await Promise.all([
      CampModel.findById(campId).select('boundary'),
      PlaceModel.find({ campId }).sort({ order: 1, createdAt: 1 }),
    ])
    if (!camp) throw new HttpError(404, 'Camp not found')
    return { boundary: camp.boundary ?? null, places: places.map(toPlace) }
  },

  create: async (campId: Types.ObjectId, input: CreateInput) => {
    assertKindRadius(input.kind, input.radiusM ?? null)
    const place = await PlaceModel.create({ ...input, campId, radiusM: input.radiusM ?? null })
    return toPlace(place)
  },

  /*
    NOTE the campId in the filter. `requireCampManager` proves authority over the camp
    in `:id`, but `:pid` is an independent URL parameter — without scoping the lookup,
    a manager of camp A could edit a place belonging to camp B just by knowing its id.
    Same reasoning applies to remove().
  */
  update: async (campId: Types.ObjectId, pid: string, patch: Partial<CreateInput>) => {
    const place = await PlaceModel.findOne({ _id: pid, campId })
    if (!place) throw new HttpError(404, 'Place not found')

    // An absent radiusM means "leave it"; an explicit null means "clear it". Resolve
    // that before validating, so the invariant sees the value that will be stored.
    const nextRadius = 'radiusM' in patch ? (patch.radiusM ?? null) : (place.radiusM ?? null)
    assertKindRadius(place.kind, nextRadius)

    Object.assign(place, patch)
    place.radiusM = nextRadius
    await place.save()
    return toPlace(place)
  },

  remove: async (campId: Types.ObjectId, pid: string) => {
    const res = await PlaceModel.deleteOne({ _id: pid, campId })
    if (res.deletedCount === 0) throw new HttpError(404, 'Place not found')
  },

  /*
    Set or clear the camp's outer circle. Returns only the boundary — the caller
    already has the camp, and re-projecting it here would duplicate toOrganizerCamp.
  */
  setBoundary: async (campId: Types.ObjectId, boundary: unknown) => {
    const camp = await CampModel.findByIdAndUpdate(
      campId,
      { $set: { boundary } },
      { new: true },
    ).select('boundary')
    if (!camp) throw new HttpError(404, 'Camp not found')
    return { boundary: camp.boundary ?? null }
  },
}
