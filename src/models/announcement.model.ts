import { Schema, model, Types, type InferSchemaType } from 'mongoose'

export const ANNOUNCEMENT_SCOPE = ['camp', 'group'] as const

const announcementSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    title: { type: String, default: null, trim: true },
    body: { type: String, required: true },
    scope: { type: String, enum: ANNOUNCEMENT_SCOPE, default: 'camp', required: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    pinned: { type: Boolean, default: false, required: true },
  },
  { timestamps: true },
)

export type Announcement = InferSchemaType<typeof announcementSchema> & { _id: Types.ObjectId }
export const AnnouncementModel = model('Announcement', announcementSchema)
