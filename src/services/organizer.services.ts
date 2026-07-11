import bcrypt from 'bcryptjs'
import type { HydratedDocument } from 'mongoose'
import { UserModel, type User } from '../models/user.model'
import { HttpError } from '../middlewares/error.middleware'
import { canonicalizePhone } from '../utils/phone'
import { sessionService } from './session.services'
import type { CreateOrganizerInput } from '../validators/organizer.validators'

const BCRYPT_ROUNDS = 12

export type PublicOrganizer = {
  id: string
  phone: string | null
  name: string
  surname: string
  active: boolean
  createdAt: string
}

function toPublicOrganizer(user: HydratedDocument<User>): PublicOrganizer {
  return {
    id: String(user._id),
    phone: user.phone ?? null,
    name: user.name,
    surname: user.surname,
    active: user.active,
    createdAt: (user as unknown as { createdAt: Date }).createdAt.toISOString(),
  }
}

export const organizerService = {
  list: async (): Promise<PublicOrganizer[]> => {
    const users = await UserModel.find({ role: 'organizer' }).sort({ createdAt: -1 })
    return users.map(toPublicOrganizer)
  },

  create: async (input: CreateOrganizerInput): Promise<PublicOrganizer> => {
    const phone = canonicalizePhone(input.phone)
    const exists = await UserModel.exists({ phone })
    if (exists) throw new HttpError(409, 'Phone already registered')

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
    const user = await UserModel.create({
      phone,
      name: input.name,
      surname: input.surname,
      role: 'organizer',
      active: true,
      passwordHash,
    })
    return toPublicOrganizer(user)
  },

  setActive: async (id: string, active: boolean): Promise<PublicOrganizer> => {
    const user = await UserModel.findOne({ _id: id, role: 'organizer' })
    if (!user) throw new HttpError(404, 'Organizer not found')
    user.active = active
    await user.save()
    // Deactivating revokes access immediately — kill every live session.
    if (!active) await sessionService.revokeAllForUser(user._id)
    return toPublicOrganizer(user)
  },
}
