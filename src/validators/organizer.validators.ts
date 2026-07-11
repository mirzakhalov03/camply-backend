import { z } from '../config/zod'

// 9 national digits — matches the frontend's PHONE_LENGTH.
const phone = z.string().regex(/^\d{9}$/, 'Phone must be 9 digits')

export const createOrganizerSchema = z.object({
  phone,
  name: z.string().min(1).max(60),
  surname: z.string().min(1).max(60),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export const updateOrganizerSchema = z.object({
  active: z.boolean(),
})

export const organizerIdParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
})

export type CreateOrganizerInput = z.infer<typeof createOrganizerSchema>
export type UpdateOrganizerInput = z.infer<typeof updateOrganizerSchema>
