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

/*
  Serve one uploaded object by REDIRECTING to a short-lived signed URL, so the
  bucket can stay private while <img src="/api/uploads/{key}"> just works.

  We redirect rather than proxy on purpose — streaming image bytes through Express
  would put every avatar on our request budget and memory. The 302 costs one cheap
  hop and hands the transfer to S3: the same reasoning that made UPLOADS go direct.

  Authorization is `requireAuth` + an unguessable key, NOT per-object ownership:
  keys are randomUUID() and are only handed out by endpoints that already scope
  their responses. That stops anonymous scraping and search-engine indexing of camp
  photos, which is the threat that mattered. See the design doc §2.2.
*/
export const getUpload: RequestHandler = async (req, res) => {
  if (!isStorageConfigured()) {
    res.status(503).json({ message: 'Storage is not configured' })
    return
  }

  /*
    Express 5 hands a NAMED wildcard back as an array of path segments, so rejoin
    it. parseKey then does the real work: anything it doesn't recognize as a key we
    minted ourselves is refused BEFORE any AWS call — which is what makes `..`
    traversal and probing of unrelated bucket prefixes non-events.
  */
  const raw = req.params.key
  const parsed = uploadService.parseKey(Array.isArray(raw) ? raw.join('/') : String(raw))
  if (!parsed) {
    res.status(400).json({ message: 'Invalid upload key' })
    return
  }

  /*
    Cached for LESS time than the signature lives, so the browser can never replay
    a cached redirect whose signature already expired. `private` keeps shared
    proxies from handing one user's redirect to another.
  */
  res.set('Cache-Control', `private, max-age=${uploadService.DOWNLOAD_EXPIRES_IN - 60}`)
  res.redirect(302, await uploadService.signDownloadUrl(parsed.key))
}
