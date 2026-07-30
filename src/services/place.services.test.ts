import { describe, it, expect } from 'vitest'
import { assertKindRadius } from './place.services'

/*
  The kind/radius invariant. This lives in the service rather than a Zod schema because
  the UPDATE path never carries `kind` in its body (kind is immutable), so the STORED
  kind is the only source of truth — see the camp-map spec §14.1. These tests pin that
  contract for BOTH write paths at once, since both call this one function.
*/
describe('assertKindRadius', () => {
  it('accepts a zone with a radius', () => {
    expect(() => assertKindRadius('zone', 45)).not.toThrow()
  })

  it('accepts a landmark with no radius', () => {
    expect(() => assertKindRadius('landmark', null)).not.toThrow()
  })

  it('rejects a zone with no radius', () => {
    expect(() => assertKindRadius('zone', null)).toThrow(/zone needs a radius/i)
  })

  it('rejects a landmark carrying a radius', () => {
    expect(() => assertKindRadius('landmark', 30)).toThrow(/landmark cannot have a radius/i)
  })

  it('treats radius 0 on a zone as present, not missing', () => {
    // Guards against a `!radiusM` truthiness check creeping in: 0 is a real number that
    // the validator's min(10) rejects, and conflating it with null would move that
    // rejection to the wrong layer with the wrong message.
    expect(() => assertKindRadius('zone', 0)).not.toThrow()
  })
})
