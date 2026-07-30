import { Schema, model, Types, type InferSchemaType } from 'mongoose'

// Only draft/published are STORED. The public upcoming/active/archived status is
// derived from dates in the projection (see camp.services toOrganizerCamp).
export const CAMP_STORED_STATUS = ['draft', 'published'] as const

const campSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    capacity: { type: Number, default: 0 },
    languages: { type: [String], default: [] }, // subset of en/uz/ru
    coverImage: { type: String, default: null },
    status: { type: String, enum: CAMP_STORED_STATUS, default: 'draft', required: true },
    clientRequestId: { type: String, default: null }, // idempotency key for batch create
    archivedAt: { type: Date, default: null }, // manual archive of a still-dated camp
    /*
      The camp's outer circle — everything outside it reads as "out of bounds" for the
      safety lens. Null until the manager places it on the map screen; a camp with no
      boundary never produces an out-of-bounds signal, so it cannot raise a false alarm.

      A sub-schema with `_id: false` rather than plain nested paths (the way
      place.model does it): Mongoose defaults a nested path to `{}` and cannot store
      null there, which would make `boundary: null` — the cleared state — impossible to
      represent.
    */
    boundary: {
      type: new Schema(
        {
          center: {
            lat: { type: Number, required: true },
            lon: { type: Number, required: true },
          },
          radiusM: { type: Number, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

// Retry-safe batch create: a repeat with the same key returns the existing camp.
campSchema.index({ clientRequestId: 1 }, { unique: true, sparse: true })

export type Camp = InferSchemaType<typeof campSchema> & { _id: Types.ObjectId }
export const CampModel = model('Camp', campSchema)
