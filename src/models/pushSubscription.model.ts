import { Schema, model, Types, type InferSchemaType } from 'mongoose'

/*
  A device's Web Push subscription. endpoint is the unique identity (a URL at the
  push service); POST /push/subscribe upserts on it so the SW's re-subscribe after
  pushsubscriptionchange never duplicates. Pruned on 410/404 at send time.
*/
const pushSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String },
  },
  { timestamps: true },
)

export type PushSubscription = InferSchemaType<typeof pushSubscriptionSchema> & {
  _id: Types.ObjectId
}
export const PushSubscriptionModel = model('PushSubscription', pushSubscriptionSchema)
