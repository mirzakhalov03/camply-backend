import { Schema, model, Types, type InferSchemaType } from 'mongoose'

export const ACTIVITY_SCOPE = ['camp', 'group'] as const

const activitySchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    title: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    scope: { type: String, enum: ACTIVITY_SCOPE, default: 'camp', required: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    description: { type: String, default: null },
    /*
      Optional link to a camp place — what turns the map from a novelty into
      wayfinding ("Breakfast · Dining hall · 340 m away"). Nullable and always
      optional: most camps fill this in gradually, and an activity with no place must
      stay perfectly valid. `location` stays as the free-text label, which is still
      what an activity outside camp geometry needs.
    */
    placeId: { type: Schema.Types.ObjectId, ref: 'Place', default: null },
  },
  { timestamps: true },
)

export type Activity = InferSchemaType<typeof activitySchema> & { _id: Types.ObjectId }
export const ActivityModel = model('Activity', activitySchema)
