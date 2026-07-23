import { Schema, model, Types, type InferSchemaType } from 'mongoose'

export const MESSAGE_CHANNELS = ['group', 'organizers'] as const
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number]

const messageSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true },
    channel: { type: String, enum: MESSAGE_CHANNELS, required: true },
    // Required + non-null iff channel === 'group'; null for the organizers room.
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
    // Embedded reactions — bounded per message (a handful of emojis). One {userId,
    // emoji} pair per reactor per emoji; toggling that pair removes it. No _id on subdocs.
    reactions: {
      type: [
        new Schema(
          {
            userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            emoji: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
)

// History load is always "latest N for this exact room" — this is that query shape.
messageSchema.index({ campId: 1, channel: 1, groupId: 1, createdAt: 1 })

export type Message = InferSchemaType<typeof messageSchema> & { _id: Types.ObjectId }
export const MessageModel = model('Message', messageSchema)
