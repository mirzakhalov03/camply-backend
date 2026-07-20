import { z } from '../config/zod'

/** The 5 MB ceiling — the ONE server-side definition. Mirrored client-side in
 *  Frontend/src/lib/upload/validateUpload.ts; change both together. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** What an uploaded image is for. Becomes the key's top-level prefix. */
export const UPLOAD_PURPOSES = ['avatar', 'group', 'camp'] as const

/** Images only, and only formats every target browser renders. */
export const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/*
  Validated BEFORE any AWS call, so an oversized or wrong-typed request never costs
  a round trip. `size` is not merely advisory: upload.services signs it as an exact
  ContentLength, so S3 rejects a body that doesn't match.
*/
export const presignSchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

export type PresignInput = z.infer<typeof presignSchema>
