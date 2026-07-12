import { Schema, model, Types, type InferSchemaType } from 'mongoose'

const groupSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, required: true }, // palette token e.g. 'pine'
    leaderMembershipId: { type: Schema.Types.ObjectId, ref: 'Membership', default: null },
    photo: { type: String, default: null },
  },
  { timestamps: true },
)

export type Group = InferSchemaType<typeof groupSchema> & { _id: Types.ObjectId }
export const GroupModel = model('Group', groupSchema)
