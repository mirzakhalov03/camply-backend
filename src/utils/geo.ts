/*
  Pure geometry for the camp map. No DB, no Express — every function here is a
  deterministic transform, which is what makes the out-of-bounds rules auditable.

  The three constants below are PRODUCT decisions, not tuning knobs (design §9):
  a safety lens that raises false alarms gets muted, and a muted lens is worse
  than no lens because it converts a real alert into background noise.
*/

export type Coords = { lat: number; lon: number }

/** A fix less accurate than this is not trustworthy enough to judge bounds with. */
export const ACCURACY_GATE_M = 50
/** You must be this far PAST the boundary to be flagged; re-entry clears at the true radius. */
export const HYSTERESIS_M = 25
/** Consecutive qualifying out-of-bounds fixes required before flagging. */
export const OB_STRIKES = 2

const EARTH_RADIUS_M = 6_371_008.8
const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in metres. Haversine is ample at camp scale. */
export function distanceM(a: Coords, b: Coords): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export type ZoneLike = { id: string; center: Coords; radiusM: number }

/*
  Which zone is this position in? SMALLEST RADIUS WINS, so a "Medical tent" drawn
  inside a larger "Assembly field" reports the tent — the more specific answer is
  the useful one for both zone counts and an organizer reading a pin.
*/
export function resolveZoneId(pos: Coords, zones: ZoneLike[]): string | null {
  let best: ZoneLike | null = null
  for (const z of zones) {
    if (distanceM(pos, z.center) > z.radiusM) continue
    if (!best || z.radiusM < best.radiusM) best = z
  }
  return best ? best.id : null
}

export type BoundsInput = {
  pos: Coords
  boundary: { center: Coords; radiusM: number } | null
  accuracyM: number
  prev: { outOfBounds: boolean; obStreak: number }
}

/*
  The out-of-bounds decision. Three guards, in this order:

    1. No boundary set  → never out of bounds. A camp whose manager hasn't drawn
       geometry cannot raise a false alarm.
    2. Poor accuracy    → return the PREVIOUS state untouched. Not "inside" — that
       would let a bad fix silently clear a real alert.
    3. Hysteresis band  → flag only past radius + HYSTERESIS_M, clear only back
       inside the true radius, so someone on the line cannot strobe.
*/
export function evaluateBounds(input: BoundsInput) {
  const { pos, boundary, accuracyM, prev } = input

  if (!boundary) return { outOfBounds: false, obStreak: 0 }
  if (accuracyM > ACCURACY_GATE_M) return { ...prev }

  const d = distanceM(pos, boundary.center)

  if (prev.outOfBounds) {
    // Already flagged: only a fix inside the TRUE radius clears it.
    return d <= boundary.radiusM
      ? { outOfBounds: false, obStreak: 0 }
      : { outOfBounds: true, obStreak: prev.obStreak }
  }

  if (d > boundary.radiusM + HYSTERESIS_M) {
    const obStreak = prev.obStreak + 1
    return { outOfBounds: obStreak >= OB_STRIKES, obStreak }
  }
  return { outOfBounds: false, obStreak: 0 }
}
