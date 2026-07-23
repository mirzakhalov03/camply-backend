import type { RequestHandler } from 'express'
import { Types } from 'mongoose'
import { PushSubscriptionModel } from '../models/pushSubscription.model'

// Upsert on endpoint — the SW re-posts after pushsubscriptionchange, so a duplicate
// must be idempotent, not a 409.
export const subscribe: RequestHandler = async (req, res) => {
  const { subscription } = req.body as {
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
  }
  await PushSubscriptionModel.updateOne(
    { endpoint: subscription.endpoint },
    {
      $set: {
        userId: new Types.ObjectId(String(req.auth!.user._id)),
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        userAgent: req.get('user-agent') ?? undefined,
      },
    },
    { upsert: true },
  )
  res.status(201).json({ ok: true })
}

export const unsubscribe: RequestHandler = async (req, res) => {
  const { endpoint } = req.body as { endpoint: string }
  await PushSubscriptionModel.deleteOne({ endpoint })
  res.status(204).end()
}
