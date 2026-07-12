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
    archivedAt: { type: Date, default: null }, // manual archive of a still-dated camp
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

export type Camp = InferSchemaType<typeof campSchema> & { _id: Types.ObjectId }
export const CampModel = model('Camp', campSchema)
