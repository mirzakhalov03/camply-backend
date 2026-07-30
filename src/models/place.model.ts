import { Schema, model, Types, type InferSchemaType } from 'mongoose'

/*
  A camp's named geography — the manager-authored half of the live map.

  Two kinds share one model because they differ only by a nullable radius, and two
  separate CRUD stacks would mean ~8 duplicated files under our
  routes → controllers → services → models layering:

    - zone     — a named circular AREA with membership ("who is in Dining hall").
                 Owns a radius. Drives zone occupancy and the safety lens.
    - landmark — a named POINT with no radius and no membership (water tap, meet
                 point). Just "it's here".

  The kind/radius invariant lives in placeService.assertKindRadius, not here — see
  the comment there for why the service is its only sensible home.
*/
export const PLACE_KINDS = ['zone', 'landmark'] as const

// Only circles are stored today. The discriminator exists so polygon zones can
// land later without a migration (design §4.1, decision 3).
export const PLACE_SHAPES = ['circle'] as const

/*
  A required sub-schema rather than plain nested paths: `InferSchemaType` widens a bare
  nested object to `| undefined` even when every leaf is `required`, which would force a
  non-null assertion at every read of `place.center`. `_id: false` keeps it a value
  object rather than a subdocument.
*/
const centerSchema = new Schema(
  {
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
  },
  { _id: false },
)

const placeSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    kind: { type: String, enum: PLACE_KINDS, required: true },
    name: { type: String, required: true, trim: true },
    icon: { type: String, required: true }, // one of PLACE_ICONS (place.validators)
    shape: { type: String, enum: PLACE_SHAPES, default: 'circle', required: true },
    center: { type: centerSchema, required: true },
    // Metres. Set for a zone, always null for a landmark.
    radiusM: { type: Number, default: null },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
)

// The only list query: every place in a camp, in the manager's chosen order.
placeSchema.index({ campId: 1, order: 1 })

export type Place = InferSchemaType<typeof placeSchema> & { _id: Types.ObjectId }
export const PlaceModel = model('Place', placeSchema)
