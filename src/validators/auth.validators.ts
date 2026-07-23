import { z } from '../config/zod'
import { ORGANIZER_SUB_ROLES } from '../models/membership.model'

// 9 national digits — matches the frontend's PHONE_LENGTH.
const phone = z.string().regex(/^\d{9}$/, 'Phone must be 9 digits')

// Participants/organizers log in by phone; the organization logs in by username.
// Password is optional on the phone branch (participants omit it) and required
// on the username branch (the org always has one).
const phoneLogin = z.object({
  phone,
  password: z.string().min(1).optional(),
})
const usernameLogin = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})
export const loginSchema = z.union([usernameLogin, phoneLogin])

export const completeProfileSchema = z.object({
  name: z.string().min(1).max(60),
  surname: z.string().min(1).max(60),
  cityId: z.string().min(1),
  age: z.coerce.number().int().min(1).max(120),
  photo: z.string().nullish(),
  subRole: z.enum(ORGANIZER_SUB_ROLES).optional(),
})

export const setLanguageSchema = z.object({
  language: z.enum(['uz', 'ru', 'en']),
})

export type LoginInput = z.infer<typeof loginSchema>
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>
export type SetLanguageInput = z.infer<typeof setLanguageSchema>
