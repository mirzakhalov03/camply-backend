import { z } from '../config/zod'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')

// :id is the camp (resolved by requireCampMember), :pid the place.
export const placeIdParams = z.object({ id: objectId, pid: objectId })

/*
  A fixed icon allowlist, same reasoning as the chat reaction emoji set: these are
  rendered back to every member of the camp, so the field is not a free text sink.
  Extend the list here — it is the single source for both the API and the picker.
*/
export const PLACE_ICONS = [
  '🏠',
  '🍽',
  '⚽',
  '⚕',
  '🚩',
  '🔥',
  '🚻',
  '💧',
  '🎪',
  '🏊',
  '🧭',
  '📚',
] as const

const coords = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
})

// A zone smaller than 10m is noise at GPS accuracy; larger than 2km stops being a
// zone and becomes the camp. The boundary itself gets a much wider range below.
const ZONE_MIN_RADIUS_M = 10
const ZONE_MAX_RADIUS_M = 2000

/*
  `kind` is deliberately absent from the update schema: turning a zone into a
  landmark (or back) changes what the record MEANS and would silently orphan its
  radius. That's a delete + create, not a patch.
*/
const placeCore = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.enum(PLACE_ICONS),
  center: coords,
  radiusM: z.number().int().min(ZONE_MIN_RADIUS_M).max(ZONE_MAX_RADIUS_M).nullable().optional(),
  order: z.number().int().nonnegative().optional(),
})

export const createPlaceSchema = placeCore.extend({
  kind: z.enum(['zone', 'landmark']),
})

export const updatePlaceSchema = placeCore.partial()

/*
  The camp boundary — one circle per camp, the thing "out of bounds" is measured
  against. Nullable so a manager can clear it; a camp with no boundary simply never
  produces an out-of-bounds signal (design §6.3).

  Wider radius range than a zone: a boundary spans a whole site, not a building.
*/
export const boundarySchema = z.object({
  boundary: z
    .object({
      center: coords,
      radiusM: z.number().int().min(50).max(20_000),
    })
    .nullable(),
})
