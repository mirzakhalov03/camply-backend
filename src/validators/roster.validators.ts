import { z } from '../config/zod'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')

export const rosterIdParams = z.object({ id: objectId, mid: objectId })
export const addRosterSchema = z.object({
  phone: z.string().min(5),
  groupId: objectId.nullable().optional(),
})
export const updateRosterSchema = z.object({
  groupId: objectId.nullable().optional(),
  role: z.string().optional(),
})
export const checkinSchema = z.object({ status: z.enum(['in', 'out']) })
