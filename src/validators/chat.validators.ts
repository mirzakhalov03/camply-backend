import { z } from '../config/zod'
import { MESSAGE_CHANNELS } from '../models/message.model'
import { uploadRefSchema, ALLOWED_CONTENT_TYPES, MAX_DOCUMENT_BYTES } from './upload.validators'

// The one text rule, shared by REST (none today) and the socket send handler.
export const messageTextSchema = z
  .string()
  .trim()
  .min(1, 'Message cannot be empty')
  .max(2000, 'Message too long')

/*
  An attachment on an outgoing message. `key` is an upload ref the caller already
  PUT to S3 (purpose `chat`); chat.services re-checks ownership with assertOwnedKey,
  so a client can't attach someone else's file.

  name/size/mime are client-supplied DISPLAY metadata. They're bounded and
  allowlisted, but they describe the file rather than authorize it — the key is the
  only field that grants anything.
*/
export const messageAttachmentSchema = z.object({
  key: uploadRefSchema,
  name: z.string().trim().min(1).max(260),
  size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
  mime: z.enum(ALLOWED_CONTENT_TYPES),
})

// Socket chat:send payload. groupId is deliberately absent — the server re-derives
// it from the caller's membership; a client-sent group is never trusted.
export const sendMessageSchema = z
  .object({
    campId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid campId'),
    channel: z.enum(MESSAGE_CHANNELS),
    // Optional now: a photo with no caption is a real message. The either-or rule
    // below is what stops a fully empty one.
    text: messageTextSchema.optional(),
    attachment: messageAttachmentSchema.optional(),
    // Optional — the message this one replies to. Room-scoped + resolved to a
    // snapshot server-side; a bad id degrades to a normal message.
    replyToId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, 'Invalid replyToId')
      .optional(),
    // Client-generated idempotency key. Optional: an older client that omits it
    // behaves exactly as before. Never trusted beyond dedupe.
    clientMsgId: z.string().uuid('Invalid clientMsgId').optional(),
  })
  /*
    A message must SAY something or CARRY something. Text was `required` before
    attachments existed; making it optional without this would accept a completely
    empty message and render a blank bubble.
  */
  .refine((m) => Boolean(m.text) || Boolean(m.attachment), {
    message: 'Message must have text or an attachment',
    path: ['text'],
  })

export type SendMessageInput = z.infer<typeof sendMessageSchema>
export type MessageAttachmentInput = z.infer<typeof messageAttachmentSchema>

// Socket chat:react payload. Same channel model as chat:send; groupId is re-derived
// server-side. A small allowlist keeps arbitrary strings out of the reactions store.
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '👏'] as const

export const reactMessageSchema = z.object({
  campId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid campId'),
  channel: z.enum(MESSAGE_CHANNELS),
  messageId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid messageId'),
  emoji: z.enum(REACTION_EMOJIS),
})

export type ReactMessageInput = z.infer<typeof reactMessageSchema>

// Socket chat:read payload — "I've read this room up to now". groupId re-derived.
export const readMessagesSchema = z.object({
  campId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid campId'),
  channel: z.enum(MESSAGE_CHANNELS),
})

export type ReadMessagesInput = z.infer<typeof readMessagesSchema>
