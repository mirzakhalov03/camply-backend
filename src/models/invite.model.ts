import { Schema, model, type InferSchemaType } from 'mongoose'

/*
  A one-time organizer invite token — mirrors session.model.ts. The raw token lives
  ONLY in the emailed link; we store its sha256 so a DB leak can't be replayed. The
  TTL index auto-purges expired invites (no cron). Deleted on accept (single-use).
*/
const inviteSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
)

inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type Invite = InferSchemaType<typeof inviteSchema>
export const InviteModel = model('Invite', inviteSchema)
