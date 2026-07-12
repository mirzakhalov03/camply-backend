import { z } from '../config/zod'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')

export const announcementIdParams = z.object({ id: objectId, aid: objectId })

const scopeSchema = z.union([
  z.object({ kind: z.literal('camp') }),
  z.object({ kind: z.literal('group'), groupId: z.string(), groupName: z.string() }),
])

export const createAnnouncementSchema = z.object({
  campId: z.string(),
  title: z.string().optional(),
  body: z.string().min(1),
  scope: scopeSchema,
  pinned: z.boolean().optional(),
})
export const updateAnnouncementSchema = z.object({
  title: z.string().nullable().optional(),
  body: z.string().min(1).optional(),
})
export const pinSchema = z.object({ pinned: z.boolean() })
