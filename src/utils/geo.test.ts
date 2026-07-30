import { describe, it, expect } from 'vitest'
import { distanceM, resolveZoneId, evaluateBounds } from './geo'

const CENTER = { lat: 41.5528, lon: 69.9876 }
const BOUNDARY = { center: CENTER, radiusM: 300 }
const GOOD_FIX = 10
const clean = { outOfBounds: false, obStreak: 0 }

/** Offset in metres → a latitude delta. ~111,320 m per degree of latitude. */
const north = (m: number) => ({ lat: CENTER.lat + m / 111_320, lon: CENTER.lon })

describe('distanceM', () => {
  it('is zero for the same point', () => {
    expect(distanceM(CENTER, CENTER)).toBe(0)
  })

  it('measures a known offset within 1%', () => {
    expect(distanceM(CENTER, north(100))).toBeCloseTo(100, -1)
  })

  it('is symmetric', () => {
    expect(distanceM(CENTER, north(250))).toBeCloseTo(distanceM(north(250), CENTER), 6)
  })
})

describe('resolveZoneId', () => {
  const zones = [
    { id: 'field', center: CENTER, radiusM: 300 },
    { id: 'tent', center: CENTER, radiusM: 40 },
  ]

  it('returns the SMALLEST containing zone when zones nest', () => {
    // A medical tent inside an assembly field should report the tent — the more
    // specific answer is the useful one for both zone counts and an organizer.
    expect(resolveZoneId(CENTER, zones)).toBe('tent')
  })

  it('falls back to the larger zone once outside the smaller one', () => {
    expect(resolveZoneId(north(100), zones)).toBe('field')
  })

  it('returns null when no zone contains the point', () => {
    expect(resolveZoneId(north(5000), zones)).toBeNull()
  })

  it('returns null for a camp with no zones', () => {
    expect(resolveZoneId(CENTER, [])).toBeNull()
  })
})

describe('evaluateBounds', () => {
  it('never flags a camp with no boundary set', () => {
    // A manager who hasn't drawn geometry must not be able to trigger false alarms.
    const r = evaluateBounds({
      pos: north(9999),
      boundary: null,
      accuracyM: GOOD_FIX,
      prev: clean,
    })
    expect(r).toEqual({ outOfBounds: false, obStreak: 0 })
  })

  it('requires TWO consecutive fixes before flagging', () => {
    const first = evaluateBounds({
      pos: north(1000),
      boundary: BOUNDARY,
      accuracyM: GOOD_FIX,
      prev: clean,
    })
    expect(first).toEqual({ outOfBounds: false, obStreak: 1 })

    const second = evaluateBounds({
      pos: north(1000),
      boundary: BOUNDARY,
      accuracyM: GOOD_FIX,
      prev: first,
    })
    expect(second).toEqual({ outOfBounds: true, obStreak: 2 })
  })

  it('ignores a low-accuracy fix and PRESERVES prior state', () => {
    // Critically not "inside": a bad fix must never silently clear a live alert.
    const flagged = { outOfBounds: true, obStreak: 2 }
    const r = evaluateBounds({
      pos: CENTER,
      boundary: BOUNDARY,
      accuracyM: 200,
      prev: flagged,
    })
    expect(r).toEqual(flagged)
  })

  it('does not flag inside the hysteresis band', () => {
    // 310m out on a 300m radius is past the edge but inside radius + 25m.
    const r = evaluateBounds({
      pos: north(310),
      boundary: BOUNDARY,
      accuracyM: GOOD_FIX,
      prev: clean,
    })
    expect(r).toEqual({ outOfBounds: false, obStreak: 0 })
  })

  it('flags beyond the hysteresis band', () => {
    const first = evaluateBounds({
      pos: north(400),
      boundary: BOUNDARY,
      accuracyM: GOOD_FIX,
      prev: clean,
    })
    const second = evaluateBounds({
      pos: north(400),
      boundary: BOUNDARY,
      accuracyM: GOOD_FIX,
      prev: first,
    })
    expect(second.outOfBounds).toBe(true)
  })

  it('clears ONLY back inside the true radius, so a person on the line cannot strobe', () => {
    const flagged = { outOfBounds: true, obStreak: 2 }
    // Still in the band — must stay flagged.
    const held = evaluateBounds({
      pos: north(310),
      boundary: BOUNDARY,
      accuracyM: GOOD_FIX,
      prev: flagged,
    })
    expect(held.outOfBounds).toBe(true)
    // Genuinely back inside — clears and resets the streak.
    const cleared = evaluateBounds({
      pos: north(200),
      boundary: BOUNDARY,
      accuracyM: GOOD_FIX,
      prev: flagged,
    })
    expect(cleared).toEqual({ outOfBounds: false, obStreak: 0 })
  })

  it('resets the streak when a fix comes back inside before flagging', () => {
    const one = evaluateBounds({
      pos: north(1000),
      boundary: BOUNDARY,
      accuracyM: GOOD_FIX,
      prev: clean,
    })
    expect(one.obStreak).toBe(1)
    const back = evaluateBounds({
      pos: CENTER,
      boundary: BOUNDARY,
      accuracyM: GOOD_FIX,
      prev: one,
    })
    expect(back).toEqual({ outOfBounds: false, obStreak: 0 })
  })
})
