import { z } from '../config/zod'

export const createOrganizerSchema = z.object({
  name: z.string().min(1).max(60),
  surname: z.string().min(1).max(60),
  email: z.string().email('A valid email is required'),
  // 9 national digits — same rule as auth/invite validators; canonicalized to
  // +998… in the service. Recorded now so the organizer needn't type it on accept.
  phone: z.string().regex(/^\d{9}$/, 'Phone must be 9 digits'),
})

export const updateOrganizerSchema = z.object({
  active: z.boolean(),
})

export const organizerIdParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
})

export type CreateOrganizerInput = z.infer<typeof createOrganizerSchema>
export type UpdateOrganizerInput = z.infer<typeof updateOrganizerSchema>
