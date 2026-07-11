import { Schema, model, type InferSchemaType } from 'mongoose'

// The role hierarchy (Context.md §3). Exported so validators, sessions, and the
// authorization middleware share one source of truth.
export const USER_ROLES = ['participant', 'organizer', 'organization'] as const

const userSchema = new Schema(
  {
    // Canonical E.164, e.g. +998901234567. Identity key for participants/organizers.
    // Optional: the organization logs in by username and has no phone.
    phone: { type: String, unique: true, sparse: true, trim: true },
    // The organization super-admin logs in by username, not phone. Sparse-unique:
    // only org accounts have one. Lowercased so 'Admin' and 'admin' can't collide.
    username: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    // Organizers are invited by email (magic-link onboarding); sparse-unique so the
    // many phone-only users don't collide. Set at invite time; phone arrives on accept.
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    surname: { type: String, required: true, trim: true },
    role: { type: String, enum: USER_ROLES, default: 'participant', required: true },
    // Deactivating an organizer sets this false; login + requireAuth reject it.
    active: { type: Boolean, default: true, required: true },
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
