import { Schema, model, type InferSchemaType } from 'mongoose'

// The role hierarchy (Context.md §3). Exported so validators, sessions, and the
// authorization middleware share one source of truth.
export const USER_ROLES = ['participant', 'organizer', 'organization'] as const

const userSchema = new Schema(
  {
    // Canonical E.164, e.g. +998901234567. The identity key — unique per person.
    phone: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    surname: { type: String, required: true, trim: true },
    role: { type: String, enum: USER_ROLES, default: 'participant', required: true },
    // Participant profile fields (the frontend registration form sends these).
    cityId: { type: String, trim: true },
    age: { type: Number },
    photo: { type: String, default: null },
    // Only org/organizer accounts have a password; participants sign in by phone.
    // select:false keeps it out of every query unless explicitly requested.
    passwordHash: { type: String, select: false },
  },
  { timestamps: true },
)

export type User = InferSchemaType<typeof userSchema>

export const UserModel = model('User', userSchema)
