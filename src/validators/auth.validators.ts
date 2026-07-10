import { z } from '../config/zod'

// 9 national digits — matches the frontend's PHONE_LENGTH.
const phone = z.string().regex(/^\d{9}$/, 'Phone must be 9 digits')

export const registerSchema = z.object({
  phone,
  name: z.string().min(1).max(60),
  surname: z.string().min(1).max(60),
  cityId: z.string().min(1),
  age: z.coerce.number().int().min(1).max(120),
  photo: z.string().nullish(),
})

// Password is optional: participants omit it, org/organizer include it.
export const loginSchema = z.object({
  phone,
  password: z.string().min(1).optional(),
})

export const createOrganizerSchema = z.object({
  phone,
  name: z.string().min(1).max(60),
  surname: z.string().min(1).max(60),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type CreateOrganizerInput = z.infer<typeof createOrganizerSchema>
