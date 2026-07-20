import { randomUUID } from 'node:crypto'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3Client } from '../config/s3'
import { env } from '../config/env'
import { HttpError } from '../middlewares/error.middleware'
import type { PresignInput } from '../validators/upload.validators'

/*
  Presigned direct-to-S3 uploads. The browser PUTs straight to the bucket, so image
  bytes never pass through this API — no request-size limits, no server bandwidth,
  no multipart parsing.
*/

// Short: the client uploads immediately after presigning or not at all. A long-lived
// URL is a long-lived write grant to the bucket.
const EXPIRES_IN = 60

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
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
  Keys are `{purpose}/{userId}/{uuid}.{ext}`. Before persisting a client-supplied key
  onto a resource, confirm the caller owns that prefix — otherwise anyone who learns
  a key could attach someone else's uploaded object to their own profile.

  Call this on EVERY write path that accepts a key from a request body.

  Accepts BOTH forms the client may hold: the bare key, and the full public URL
  (camp.coverImage is validated as a URL, and presign returns a CDN URL whenever
  S3_PUBLIC_BASE_URL is set). Anything that isn't one of our own keys — an
  arbitrary external URL, say — is rejected rather than silently trusted.
*/
export function assertOwnedKey(rawKey: string, userId: string): void {
  let key = rawKey

  // Strip our own public base, so a CDN URL reduces to the key it points at.
  const base = env.S3_PUBLIC_BASE_URL
  if (base && key.startsWith(base)) {
    key = key.slice(base.length).replace(/^\//, '')
  }

  const segments = key.split('/')
  const [purpose, owner, ...rest] = segments
  const wellFormed =
    segments.length === 3 && Boolean(purpose) && Boolean(rest[0]) && !purpose.includes(':')

  if (!wellFormed || owner !== userId) {
    throw new HttpError(403, 'This upload does not belong to you')
  }
}
