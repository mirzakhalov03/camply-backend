import webpush from 'web-push'
import { Types } from 'mongoose'
import { env } from '../../config/env'
import { PushSubscriptionModel } from '../../models/pushSubscription.model'

export type PushPayload = { title: string; body: string; url: string; tag?: string }

let configured = false
function ensureConfigured(): boolean {
  if (configured) return true
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.warn('⚠️  Web Push disabled: VAPID keys unset (run `npm run vapid:gen`).')
    return false
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
  configured = true
  return true
}

export const pushSender = {
  // Send to every device the user has. Dead endpoints (410/404) self-prune.
  sendToUser: async (userId: Types.ObjectId, payload: PushPayload): Promise<void> => {
    if (!ensureConfigured()) return
    const subs = await PushSubscriptionModel.find({ userId })
    await Promise.all(
      subs.map(async (sub) => {
        if (!sub.keys?.p256dh || !sub.keys.auth) return
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
            JSON.stringify(payload),
          )
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          if (status === 410 || status === 404) {
            await PushSubscriptionModel.deleteOne({ _id: sub._id })
          } else {
            console.error('push send failed', status, sub.endpoint)
          }
        }
      }),
    )
  },
}
