import { z } from '../config/zod'

// Mirrors organizer.validators — the frontend NewManagerSheet reuses the same inputs
// (name/surname/email + 9 national digits, canonicalized to +998… in the service).
export const createManagerSchema = z.object({
  name: z.string().min(1).max(60),
  surname: z.string().min(1).max(60),
  email: z.string().email('A valid email is required'),
  phone: z.string().regex(/^\d{9}$/, 'Phone must be 9 digits'),
})

export const updateManagerSchema = z.object({
  active: z.boolean(),
})

export const managerIdParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
})

export type CreateManagerInput = z.infer<typeof createManagerSchema>
export type UpdateManagerInput = z.infer<typeof updateManagerSchema>
