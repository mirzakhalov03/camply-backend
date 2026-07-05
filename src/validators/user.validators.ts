import { z } from '../config/zod'

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
})

export const userIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
})

export type CreateUserInput = z.infer<typeof createUserSchema>
