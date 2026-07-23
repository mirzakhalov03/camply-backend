import { Schema, model, Types, type InferSchemaType } from 'mongoose'
import { MESSAGE_CHANNELS } from './message.model'

/*
  One last-read marker per member per room. Powers both the double-tick ("seen by
  anyone" = any OTHER member's lastReadAt ≥ a message) and the unread badge (messages
  after MY lastReadAt). groupId is null for the organizers channel.
*/
const chatReadSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true },
    channel: { type: String, enum: MESSAGE_CHANNELS, required: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lastReadAt: { type: Date, required: true },
  },
  { timestamps: true },
)

// One marker per {room, user}; also the query shape for othersLastReadAt.
chatReadSchema.index({ campId: 1, channel: 1, groupId: 1, userId: 1 }, { unique: true })

export type ChatRead = InferSchemaType<typeof chatReadSchema> & { _id: Types.ObjectId }
export const ChatReadModel = model('ChatRead', chatReadSchema)
