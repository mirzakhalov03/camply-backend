import { z } from '../config/zod'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')

export const groupIdParams = z.object({ id: objectId, gid: objectId })
export const createGroupSchema = z.object({ name: z.string().min(1), color: z.string().min(1) })
export const updateGroupSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  leaderMembershipId: objectId.nullable().optional(),
})
