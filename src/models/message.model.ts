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
    // Optional denormalized snapshot of the message this one replies to. Stored
    // (not populated) so the quote survives deletion of the original. Built
    // server-side from a client-sent replyToId — see chat.services.postMessage.
    replyTo: {
      type: new Schema(
        {
          messageId: { type: Schema.Types.ObjectId, ref: 'Message', required: true },
          authorName: { type: String, required: true },
          text: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    // Client-generated UUID for send idempotency. The outbox retries a send whose
    // echo it never saw; without this, a retry after a successful persist would
    // double-post. Trusted for DEDUPE ONLY — never identity, ordering, or authz.
    clientMsgId: { type: String, default: undefined },
  },
  { timestamps: true },
)

// History load is always "latest N for this exact room" — this is that query shape.
messageSchema.index({ campId: 1, channel: 1, groupId: 1, createdAt: 1 })

/*
  Send idempotency: one message per (author, clientMsgId).

  This MUST be `partialFilterExpression`, NOT `sparse`. A compound sparse index
  includes a document that has AT LEAST ONE of the indexed fields — every
  existing message has an authorId, so all of them would be indexed with
  clientMsgId: null, and the second pre-existing message by any author would
  throw E11000 under `unique`. A partial index covers only documents that
  actually carry a clientMsgId.
*/
messageSchema.index(
  { authorId: 1, clientMsgId: 1 },
  { unique: true, partialFilterExpression: { clientMsgId: { $exists: true } } },
)

export type Message = InferSchemaType<typeof messageSchema> & { _id: Types.ObjectId }
export const MessageModel = model('Message', messageSchema)
