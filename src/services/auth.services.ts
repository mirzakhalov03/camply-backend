import bcrypt from 'bcryptjs'
import type { HydratedDocument } from 'mongoose'
import { UserModel, type User } from '../models/user.model'
import { HttpError } from '../middlewares/error.middleware'
import { canonicalizePhone } from '../utils/phone'
import { sessionService } from './session.services'
import type { RegisterInput, LoginInput, CreateOrganizerInput } from '../validators/auth.validators'

const BCRYPT_ROUNDS = 12

export type PublicUser = {
  id: string
  phone: string
  name: string
  surname: string
  role: 'participant' | 'organizer' | 'organization'
}

// The ONLY shape that leaves the server — passwordHash never appears here.
function toPublicUser(user: HydratedDocument<User>): PublicUser {
  return {
    id: String(user._id),
    phone: user.phone,
    name: user.name,
    surname: user.surname,
    role: user.role,
  }
}

export const authService = {
  register: async (input: RegisterInput, userAgent?: string) => {
    const phone = canonicalizePhone(input.phone)
    const exists = await UserModel.exists({ phone })
    if (exists) throw new HttpError(409, 'Phone already registered')

    // Role is PINNED to participant. Never trust a client-sent role (guardrail).
    const user = await UserModel.create({
      phone,
      name: input.name,
      surname: input.surname,
      cityId: input.cityId,
      age: input.age,
      photo: input.photo ?? null,
      role: 'participant',
    })

    const token = await sessionService.create(user._id, 'participant', userAgent)
    return { token, user: toPublicUser(user) }
  },

  login: async (input: LoginInput, userAgent?: string) => {
    const phone = canonicalizePhone(input.phone)
    // passwordHash is select:false, so pull it explicitly for the check.
    const user = await UserModel.findOne({ phone }).select('+passwordHash')
    if (!user) throw new HttpError(401, 'Invalid credentials')

    // Org/organizer accounts require a password; participants sign in by phone alone.
    if (user.passwordHash) {
      if (!input.password) throw new HttpError(401, 'Password required')
      const ok = await bcrypt.compare(input.password, user.passwordHash)
      if (!ok) throw new HttpError(401, 'Invalid credentials')
    }

    const token = await sessionService.create(user._id, user.role, userAgent)
    return { token, user: toPublicUser(user) }
  },

  // Called by the org-only POST /organizers route (authorization enforced there).
  createOrganizer: async (input: CreateOrganizerInput): Promise<PublicUser> => {
    const phone = canonicalizePhone(input.phone)
    const exists = await UserModel.exists({ phone })
    if (exists) throw new HttpError(409, 'Phone already registered')

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
    const user = await UserModel.create({
      phone,
      name: input.name,
      surname: input.surname,
      role: 'organizer',
      passwordHash,
    })
    return toPublicUser(user)
  },
}
