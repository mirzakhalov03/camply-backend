import { z } from '../config/zod'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')

export const leaderboardParams = z.object({ id: objectId, gid: objectId })
export const adjustPointsSchema = z.object({
  delta: z.number().int(),
  category: z.enum(['activities', 'attendance', 'challenges']),
})
