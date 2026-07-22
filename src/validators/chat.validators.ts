import { z } from '../config/zod'
import { MESSAGE_CHANNELS } from '../models/message.model'

// The one text rule, shared by REST (none today) and the socket send handler.
export const messageTextSchema = z
  .string()
  .trim()
  .min(1, 'Message cannot be empty')
  .max(2000, 'Message too long')

// Socket chat:send payload. groupId is deliberately absent — the server re-derives
// it from the caller's membership; a client-sent group is never trusted.
export const sendMessageSchema = z.object({
  campId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid campId'),
  channel: z.enum(MESSAGE_CHANNELS),
  text: messageTextSchema,
})

export type SendMessageInput = z.infer<typeof sendMessageSchema>
