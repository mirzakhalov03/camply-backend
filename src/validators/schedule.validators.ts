import { z } from '../config/zod'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')

export const activityIdParams = z.object({ id: objectId, aid: objectId })

const scopeSchema = z.union([
  z.object({ kind: z.literal('camp') }),
  z.object({ kind: z.literal('group'), groupId: z.string(), groupName: z.string() }),
])

export const createActivitySchema = z.object({
  campId: z.string(),
  title: z.string().min(1),
  location: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  scope: scopeSchema,
  description: z.string().nullable().optional(),
  /*
    Optional link to a camp Place. Nullable AND optional on purpose: absent means
    "leave it alone" on a PATCH, an explicit null means "unlink". Most activities
    never carry one.
  */
  placeId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')
    .nullable()
    .optional(),
})
export const updateActivitySchema = createActivitySchema.partial()
