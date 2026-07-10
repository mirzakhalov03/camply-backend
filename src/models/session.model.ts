import { Schema, model, type InferSchemaType } from 'mongoose'
import { USER_ROLES } from './user.model'

const sessionSchema = new Schema(
  {
    // sha256 of the raw cookie value. The raw token exists ONLY in the cookie;
    // storing the hash means a DB leak can't replay live sessions.
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Snapshot of the role at session creation (convenience; User is authoritative).
    role: { type: String, enum: USER_ROLES, required: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true, default: Date.now },
    userAgent: { type: String },
  },
  { timestamps: true },
)

// TTL index: Mongo auto-deletes a session the moment expiresAt passes — no cron.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type Session = InferSchemaType<typeof sessionSchema>

export const SessionModel = model('Session', sessionSchema)
