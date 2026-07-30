import { z } from '../config/zod'

/*
  The socket payload. Validated manually in the handler — the socket layer bypasses
  the validate(...) middleware, exactly like chat's sendMessageSchema.
*/
export const reportSchema = z.object({
  campId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  // A browser fix always carries accuracy; refuse an unbounded number.
  accuracyM: z.number().min(0).max(100_000),
})

export const sharingSchema = z.object({ enabled: z.boolean() })
