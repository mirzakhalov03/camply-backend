import { z } from '../config/zod'

export const campIdParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
})

export const createCampSchema = z.object({
  name: z.string().min(1),
  location: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  capacity: z.number().int().nonnegative().optional(),
  languages: z.array(z.enum(['en', 'uz', 'ru'])).optional(),
  coverImage: z.string().url().nullable().optional(),
})

export const updateCampSchema = createCampSchema.partial()
