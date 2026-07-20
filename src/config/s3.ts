import { S3Client } from '@aws-sdk/client-s3'
import { env } from './env'

/*
  The S3 client, constructed LAZILY so importing this module never throws when
  credentials are absent. Storage being unconfigured is an operational state, not a
  crash: callers check isStorageConfigured() and return 503, which keeps the whole
  API bootable before the bucket exists.

  env.ts already enforces all-or-nothing, so "configured" is never half-true here.
*/
let client: S3Client | null = null

export function isStorageConfigured(): boolean {
  return Boolean(
    env.AWS_REGION && env.AWS_S3_BUCKET && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY,
  )
}

export function getS3Client(): S3Client {
  if (!isStorageConfigured()) {
    throw new Error('S3 is not configured — check isStorageConfigured() before calling.')
  }
  if (!client) {
    client = new S3Client({
      region: env.AWS_REGION!,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  }
  return client
}
