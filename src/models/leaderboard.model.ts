import { Schema, model, Types, type InferSchemaType } from 'mongoose'

export const POINT_CATEGORIES = ['activities', 'attendance', 'challenges'] as const

const groupPointsSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    activities: { type: Number, default: 0 },
    attendance: { type: Number, default: 0 },
    challenges: { type: Number, default: 0 },
    previousScore: { type: Number, default: 0 }, // snapshot → drives the trend arrow
  },
  { timestamps: true },
)
groupPointsSchema.index({ campId: 1, groupId: 1 }, { unique: true })

const pointEventSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    category: { type: String, enum: POINT_CATEGORIES, required: true },
    delta: { type: Number, required: true },
    byUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

export type GroupPoints = InferSchemaType<typeof groupPointsSchema> & { _id: Types.ObjectId }
export type PointEvent = InferSchemaType<typeof pointEventSchema> & { _id: Types.ObjectId }
export const GroupPointsModel = model('GroupPoints', groupPointsSchema)
export const PointEventModel = model('PointEvent', pointEventSchema)
