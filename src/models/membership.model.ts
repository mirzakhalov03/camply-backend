import { Schema, model, Types, type InferSchemaType } from 'mongoose'

// The canonical organizer sub-roles (frontend components/organizer/roles.ts).
// Any of these is "organizer-tier" and grants camp management. Granular per-role
// permission enforcement is post-launch (CONTEXT §7) — captured, not gated.
// `projectManager` was promoted to the first-class `manager` account role (2026-07-15).
export const ORGANIZER_SUB_ROLES = [
  'coordinator',
  'admin',
  'media',
  'brandFace',
  'eventManager',
  'photographer',
] as const

// A manager's own per-camp row is labelled 'manager'; organizers carry a sub-role.
export const MEMBERSHIP_ROLES = ['participant', 'manager', ...ORGANIZER_SUB_ROLES] as const
export const CHECKIN_STATUS = ['in', 'out'] as const
export const MEMBERSHIP_STATUS = ['pending', 'active'] as const

const membershipSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true },
    phone: { type: String, required: true, trim: true }, // E.164 — the join key
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // bound on signup
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    role: { type: String, enum: MEMBERSHIP_ROLES, default: 'participant', required: true },
    checkin: { type: String, enum: CHECKIN_STATUS, default: 'out', required: true },
    status: { type: String, enum: MEMBERSHIP_STATUS, default: 'pending', required: true },
  },
  { timestamps: true },
)

// One membership per phone per camp.
membershipSchema.index({ campId: 1, phone: 1 }, { unique: true })
// The ≤2-camps check and signup binding both query by phone.
membershipSchema.index({ phone: 1, role: 1 })

export type Membership = InferSchemaType<typeof membershipSchema> & { _id: Types.ObjectId }
export const MembershipModel = model('Membership', membershipSchema)
