import { z } from '../config/zod'

/** The 5 MB image ceiling — the ONE server-side definition. Mirrored client-side in
 *  Frontend/src/lib/upload/validateUpload.ts; change both together. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** Documents get more room: a slide deck or scanned PDF blows past 5 MB routinely,
 *  and unlike an avatar there's no resize that would fix it. */
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024

/** What an upload is for. Becomes the key's top-level prefix. */
export const UPLOAD_PURPOSES = ['avatar', 'group', 'camp', 'chat'] as const

/** Images only, and only formats every target browser renders. */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/*
  Documents, allowed ONLY for the `chat` purpose (an avatar is never a spreadsheet).

  An explicit allowlist, never a wildcard: the bucket serves these back through a
  redirect, so anything renderable-and-scriptable would be a stored-XSS vector.
  `image/svg+xml` is deliberately absent for exactly that reason — SVG is a script
  container, not a picture.
*/
export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
] as const

export const ALLOWED_CONTENT_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOCUMENT_TYPES] as const

export function isDocumentType(contentType: string): boolean {
  return (ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(contentType)
}

/*
  Validated BEFORE any AWS call, so an oversized or wrong-typed request never costs
  a round trip. `size` is not merely advisory: upload.services signs it as an exact
  ContentLength, so S3 rejects a body that doesn't match.

  The two cross-field rules live in superRefine because they depend on `purpose` and
  `contentType` together, which a flat schema can't express:
    1. documents are chat-only;
    2. the size ceiling depends on which kind it is.
*/
export const presignSchema = z
  .object({
    purpose: z.enum(UPLOAD_PURPOSES),
    contentType: z.enum(ALLOWED_CONTENT_TYPES),
    size: z.number().int().positive(),
  })
  .superRefine((input, ctx) => {
    const isDoc = isDocumentType(input.contentType)

    if (isDoc && input.purpose !== 'chat') {
      ctx.addIssue({
        code: 'custom',
        path: ['contentType'],
        message: 'Documents can only be attached to chat messages',
      })
    }

    const limit = isDoc ? MAX_DOCUMENT_BYTES : MAX_UPLOAD_BYTES
    if (input.size > limit) {
      ctx.addIssue({
        code: 'custom',
        path: ['size'],
        message: `File must be under ${Math.round(limit / 1024 / 1024)} MB`,
      })
    }
  })

export type PresignInput = z.infer<typeof presignSchema>

/*
  A reference to an already-uploaded object, as it arrives on a WRITE body
  (`camp.coverImage`, `group.photo`, `user.photo`). Deliberately a plain bounded
  string, for two reasons:

  1. The real check is `uploadService.assertOwnedKey`, which every such write path
     calls. It parses the exact `{purpose}/{userId}/{uuid}.{ext}` shape and rejects
     anything we didn't mint — strictly STRONGER than any schema here.
  2. Importing that parser into a validator would close an import cycle
     (upload.services already imports UPLOAD_PURPOSES from this file).

  This replaced `z.string().url()` on coverImage, which was an outright bug: presign
  returns a BARE KEY whenever S3_PUBLIC_BASE_URL is unset, so a perfectly valid
  upload 400'd before it ever reached the ownership check.
*/
export const uploadRefSchema = z.string().min(1).max(512)
