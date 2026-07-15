import bcrypt from 'bcryptjs'
import type { HydratedDocument } from 'mongoose'
import { UserModel, type User } from '../models/user.model'
import { MembershipModel } from '../models/membership.model'
import { HttpError } from '../middlewares/error.middleware'
import { canonicalizePhone } from '../utils/phone'
import { sessionService } from './session.services'
import { membershipService } from './membership.services'
import type { LoginInput, CompleteProfileInput } from '../validators/auth.validators'

export type PublicUser = {
  id: string
  // Null for the organization super-admin, which logs in by username, not phone.
  phone: string | null
  name: string
  surname: string
  role: 'participant' | 'organizer' | 'manager' | 'organization'
  cityId: string | null
  age: number | null
  photo: string | null
  subRole: string | null
  profileComplete: boolean
}

// The ONLY shape that leaves the server — passwordHash never appears here.
export function toPublicUser(user: HydratedDocument<User>): PublicUser {
  const cityId = user.cityId ?? null
  const age = user.age ?? null
  return {
    id: String(user._id),
    phone: user.phone ?? null,
    name: user.name ?? '',
    surname: user.surname ?? '',
    role: user.role,
    cityId,
    age,
    photo: user.photo ?? null,
    subRole: user.subRole ?? null,
    profileComplete: Boolean(user.name) && Boolean(cityId) && typeof age === 'number' && age > 0,
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
    let user = await UserModel.findOne(query).select('+passwordHash')

    // Organizer/org accounts must already exist; only participants can be claimed.
    if (!user && 'phone' in query) {
      const phone = query.phone as string
      const claimable = await MembershipModel.exists({ phone, role: 'participant', userId: null })
      if (!claimable) throw new HttpError(401, 'Invalid credentials')
      try {
        user = await UserModel.create({ phone, role: 'participant', active: true })
      } catch (err) {
        // Double-submit race: another request just created it. Re-read.
        // Anything other than a duplicate-key collision is a real failure — rethrow it.
        if (!(err && typeof err === 'object' && 'code' in err && err.code === 11000)) throw err
        user = await UserModel.findOne({ phone }).select('+passwordHash')
      }
    }
    if (!user) throw new HttpError(401, 'Invalid credentials')

    // Deactivated accounts (e.g. a revoked organizer) cannot sign in.
    if (!user.active) throw new HttpError(401, 'Invalid credentials')

    // An invited organizer OR manager must accept the email link first. Their phone is
    // set at invite time, but the pre-set phone alone must not grant entry — email is
    // the way in. Once acceptedAt is set, normal phone login works.
    if ((user.role === 'organizer' || user.role === 'manager') && !user.acceptedAt) {
      throw new HttpError(401, 'Invalid credentials')
    }

    // Org/organizer accounts require a password; participants sign in by phone alone.
    if (user.passwordHash) {
      if (!input.password) throw new HttpError(401, 'Password required')
      const ok = await bcrypt.compare(input.password, user.passwordHash)
      if (!ok) throw new HttpError(401, 'Invalid credentials')
    }

    // Attach any organizer-seeded camp memberships for this phone (additive,
    // idempotent — a no-op once bound). Org accounts have no phone, so skip them.
    if (user.phone) await membershipService.bindPhone(user._id, user.phone)

    const token = await sessionService.create(user._id, user.role, userAgent)
    return { token, user: toPublicUser(user) }
  },

  // The caller completes their OWN profile. phone/role are never touched here.
  completeProfile: async (
    user: HydratedDocument<User>,
    input: CompleteProfileInput,
  ): Promise<PublicUser> => {
    user.name = input.name
    user.surname = input.surname
    user.cityId = input.cityId
    user.age = input.age
    if (input.photo !== undefined) user.photo = input.photo ?? null
    // Sub-role is an organizer concept; ignore it for participants ("store, not enforce").
    if (user.role === 'organizer' && input.subRole) user.subRole = input.subRole
    await user.save()
    return toPublicUser(user)
  },
}
