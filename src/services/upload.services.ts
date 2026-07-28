import { randomUUID } from 'node:crypto'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3Client } from '../config/s3'
import { env } from '../config/env'
import { HttpError } from '../middlewares/error.middleware'
import { UPLOAD_PURPOSES, type PresignInput } from '../validators/upload.validators'

/*
  Presigned direct-to-S3 uploads. The browser PUTs straight to the bucket, so image
  bytes never pass through this API — no request-size limits, no server bandwidth,
  no multipart parsing.
*/

// Short: the client uploads immediately after presigning or not at all. A long-lived
// URL is a long-lived write grant to the bucket.
const EXPIRES_IN = 60

/*
  contentType → file extension. The extension is cosmetic (S3 serves the stored
  Content-Type), but it keeps keys readable and lets parseKey stay strict.
  Every entry here must also appear in EXTENSIONS below, or the object becomes
  unreadable the moment it's written.
*/
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
}

export type PresignResult = {
  uploadUrl: string
  key: string
  publicUrl: string
  expiresIn: number
}

export async function presign(input: PresignInput, userId: string): Promise<PresignResult> {
  const key = `${input.purpose}/${userId}/${randomUUID()}.${EXT[input.contentType]}`

  /*
    ContentLength is SIGNED, not merely declared. S3 rejects any body whose length
    differs from the signed value, which is what turns the 5 MB ceiling into a real
    server-side guarantee rather than a client-side suggestion.

    (`content-length-range` is a POST-policy feature and unavailable on a presigned
    PUT; signing an exact length is the PUT equivalent.)
  */
  const command = new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET!,
    Key: key,
    ContentType: input.contentType,
    ContentLength: input.size,
  })

  const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: EXPIRES_IN })

  return {
    uploadUrl,
    key,
    // Without a CDN base the key IS the reference; the client resolves it later.
    publicUrl: env.S3_PUBLIC_BASE_URL ? `${env.S3_PUBLIC_BASE_URL}/${key}` : key,
    expiresIn: EXPIRES_IN,
  }
}

/*
  ── The ONE key parser ───────────────────────────────────────────────────────────
  Keys are `{purpose}/{userId}/{uuid}.{ext}` — the shape `presign` mints above.

  Both security checks in this file run through here, deliberately: ownership (can
  you ATTACH this key to a resource?) and download (may this key be SIGNED for
  reading?). One parser means the two can never disagree about what a valid key is.

  It is strict because the download route feeds it attacker-controlled path text:
  a permissive parser is how `..` traversal and probes at unrelated bucket prefixes
  get through. Everything not minted by `presign` is rejected.

  Accepts BOTH forms the client may hold: the bare key, and a full public URL under
  our own base (presign returns a CDN URL whenever S3_PUBLIC_BASE_URL is set). An
  arbitrary external URL is not one of ours, so it fails.
*/
const OBJECT_ID = /^[0-9a-fA-F]{24}$/
// Kept in lockstep with EXT above — an extension we mint but don't accept here
// would write objects that can never be read back.
const EXTENSIONS = Object.values(EXT).join('|')
const FILENAME = new RegExp(`^[0-9a-f-]{36}\\.(${EXTENSIONS})$`)

export type ParsedKey = { key: string; purpose: string; userId: string }

export function parseKey(raw: string): ParsedKey | null {
  let key = raw

  // Strip our own public base, so a CDN URL reduces to the key it points at.
  const base = env.S3_PUBLIC_BASE_URL
  if (base && key.startsWith(base)) {
    key = key.slice(base.length).replace(/^\//, '')
  }

  const segments = key.split('/')
  if (segments.length !== 3) return null

  const [purpose, userId, filename] = segments
  if (!UPLOAD_PURPOSES.includes(purpose as (typeof UPLOAD_PURPOSES)[number])) return null
  if (!OBJECT_ID.test(userId)) return null
  if (!FILENAME.test(filename)) return null

  return { key, purpose, userId }
}

/*
  Before persisting a client-supplied key onto a resource, confirm the caller owns
  that prefix — otherwise anyone who learns a key could attach someone else's
  uploaded object to their own profile.

  Call this on EVERY write path that accepts a key from a request body.
*/
export function assertOwnedKey(rawKey: string, userId: string): void {
  const parsed = parseKey(rawKey)
  if (!parsed || parsed.userId !== userId) {
    throw new HttpError(403, 'This upload does not belong to you')
  }
}

/*
  How long a download signature lives. Short, because the redirect that carries it
  is itself cached for less (see the controller): the browser must never be able to
  replay a cached redirect whose signature already expired.
*/
export const DOWNLOAD_EXPIRES_IN = 300

/** Sign a temporary GET for one object. The bucket stays private; this is the
 *  only way bytes leave it. */
export async function signDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: env.AWS_S3_BUCKET!, Key: key })
  return getSignedUrl(getS3Client(), command, { expiresIn: DOWNLOAD_EXPIRES_IN })
}
