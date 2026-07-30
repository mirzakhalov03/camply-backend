import { Schema, model, Types, type InferSchemaType } from 'mongoose'

/*
  A participant's CURRENT position in a camp — one document per {campId,userId},
  UPSERTED, never inserted.

  There is no location history collection and there will not be one. The whole
  difference between "current position" and "movement track of a minor" is that
  upsert, and only one of those is something we would want to be holding.
  A TTL index means even the current value evaporates on its own.

  lat/lon/zoneId are ALL NULL whenever the owner has sharing off: the server still
  evaluates bounds, then discards the coordinates before writing (design §5.3).
  That is what makes the toggle's copy literally true rather than a promise —
  answering "has Aziz left the camp?" needs no stored coordinates, because the
  question was already answered at write time.
*/
const locationSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    accuracyM: { type: Number, default: null },
    zoneId: { type: Schema.Types.ObjectId, ref: 'Place', default: null },
    outOfBounds: { type: Boolean, default: false },
    // Consecutive qualifying out-of-bounds fixes. Server-only; never projected.
    obStreak: { type: Number, default: 0 },
    reportedAt: { type: Date, required: true },
  },
  { timestamps: true },
)

// One current position per person per camp — the upsert key.
locationSchema.index({ campId: 1, userId: 1 }, { unique: true })
// Self-expiry. 24h outlives any camp day without retaining a trail.
locationSchema.index({ reportedAt: 1 }, { expireAfterSeconds: 86_400 })
// The safety-lens query: "who in this camp is out of bounds".
locationSchema.index({ campId: 1, outOfBounds: 1 })

export type Location = InferSchemaType<typeof locationSchema> & { _id: Types.ObjectId }
export const LocationModel = model('Location', locationSchema)
