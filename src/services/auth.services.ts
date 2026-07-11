import bcrypt from 'bcryptjs'
import type { HydratedDocument } from 'mongoose'
import { UserModel, type User } from '../models/user.model'
import { HttpError } from '../middlewares/error.middleware'
import { canonicalizePhone } from '../utils/phone'
import { sessionService } from './session.services'
import type { LoginInput, CompleteProfileInput } from '../validators/auth.validators'

export type PublicUser = {
  id: string
  // Null for the organization super-admin, which logs in by username, not phone.
  phone: string | null
  name: string
  surname: string
  role: 'participant' | 'organizer' | 'organization'
  cityId: string | null
  age: number | null
  photo: string | null
  profileComplete: boolean
}

// The ONLY shape that leaves the server — passwordHash never appears here.
export function toPublicUser(user: HydratedDocument<User>): PublicUser {
  const cityId = user.cityId ?? null
  const age = user.age ?? null
  return {
    id: String(user._id),
    phone: user.phone ?? null,
    name: user.name,
    surname: user.surname,
    role: user.role,
    cityId,
    age,
    photo: user.photo ?? null,
    profileComplete: Boolean(cityId) && typeof age === 'number' && age > 0,
  }
}

export const authService = {
  login: async (input: LoginInput, userAgent?: string) => {
    // Look the user up by username (org) or phone (participant/organizer).
    const query =
      'username' in input && input.username
        ? { username: input.username.toLowerCase() }
        : { phone: canonicalizePhone((input as { phone: string }).phone) }
    // passwordHash is select:false, so pull it explicitly for the check.
    const user = await UserModel.findOne(query).select('+passwordHash')
    if (!user) throw new HttpError(401, 'Invalid credentials')

    // Deactivated accounts (e.g. a revoked organizer) cannot sign in.
    if (!user.active) throw new HttpError(401, 'Invalid credentials')

    // Org/organizer accounts require a password; participants sign in by phone alone.
    if (user.passwordHash) {
      if (!input.password) throw new HttpError(401, 'Password required')
      const ok = await bcrypt.compare(input.password, user.passwordHash)
      if (!ok) throw new HttpError(401, 'Invalid credentials')
    }

    const token = await sessionService.create(user._id, user.role, userAgent)
    return { token, user: toPublicUser(user) }
  },

  // The caller completes their OWN profile. phone/name/surname/role are never
  // touched here — the organizer owns those.
  completeProfile: async (
    user: HydratedDocument<User>,
    input: CompleteProfileInput,
  ): Promise<PublicUser> => {
    user.cityId = input.cityId
    user.age = input.age
    if (input.photo !== undefined) user.photo = input.photo ?? null
    await user.save()
    return toPublicUser(user)
  },
}
