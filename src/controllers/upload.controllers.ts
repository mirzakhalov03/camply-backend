import type { RequestHandler } from 'express'
import { isStorageConfigured } from '../config/s3'
import * as uploadService from '../services/upload.services'

/*
  Mint a presigned PUT for the caller. Returns 503 (not 500) when storage isn't
  configured: it's a deployment state the client can explain to the user, not a bug.
*/
export const createPresignedUpload: RequestHandler = async (req, res) => {
  if (!isStorageConfigured()) {
    res.status(503).json({ message: 'Storage is not configured' })
    return
  }
  res.json(await uploadService.presign(req.body, String(req.auth!.user._id)))
}
