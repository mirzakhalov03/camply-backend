import { z } from '../config/zod'

export const campIdParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
})

// Core camp fields — shared by create and (partial) update.
const campCoreSchema = z.object({
  name: z.string().min(1),
  location: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  capacity: z.number().int().nonnegative().optional(),
  languages: z.array(z.enum(['en', 'uz', 'ru'])).optional(),
  coverImage: z.string().url().nullable().optional(),
})

// Create accepts the optional batch payload (groups + participants) and a status.
// Registered for OpenAPI as this plain object; the refined version below is used for
// request validation (a ZodEffects can't be .register()'d/.partial()'d cleanly).
export const createCampObject = campCoreSchema.extend({
  status: z.enum(['draft', 'published']).optional(),
  clientRequestId: z.string().min(1).optional(),
  groups: z
    .array(z.object({ ref: z.string().min(1), name: z.string().min(1), color: z.string().min(1) }))
    .optional(),
  participants: z
    .array(z.object({ phone: z.string().min(1), groupRef: z.string().min(1).nullable() }))
    .optional(),
})

export const createCampSchema = createCampObject.superRefine((data, ctx) => {
  const refs = new Set<string>()
  for (const g of data.groups ?? []) {
    if (refs.has(g.ref)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate group ref: ${g.ref}`, path: ['groups'] })
    }
    refs.add(g.ref)
  }
  ;(data.participants ?? []).forEach((p, i) => {
    if (p.groupRef !== null && !refs.has(p.groupRef)) {
      ctx.addIssue({
        code: 'custom',
        message: `Participant ${i} references unknown group ref: ${p.groupRef}`,
        path: ['participants', i, 'groupRef'],
      })
    }
  })
})

// PATCH stays camp-core only — no batch fields, no status/clientRequestId.
export const updateCampSchema = campCoreSchema.partial()
