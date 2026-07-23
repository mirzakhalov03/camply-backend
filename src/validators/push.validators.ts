import { z } from '../config/zod'

// The browser's PushSubscription.toJSON() shape. keys are always present for a real
// subscription; endpoint is the unique identity we upsert on.
export const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  }),
})

export const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
})

export type SubscribeInput = z.infer<typeof subscribeSchema>
export type UnsubscribeInput = z.infer<typeof unsubscribeSchema>
