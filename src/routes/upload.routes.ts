import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middlewares/auth.middleware'
import { validate } from '../middlewares/validate.middleware'
import { presignSchema } from '../validators/upload.validators'
import { createPresignedUpload, getUpload } from '../controllers/upload.controllers'

/*
  Its own limiter bucket, separate from authLimiter: presigning is cheap but not
  free, and an unbounded loop would mint unlimited write grants against the bucket.
  60/15min is generous for a human picking images, tight for a script.
*/
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many upload requests, please try again later' },
})

const router = Router()

// Any authenticated user may upload — the key is namespaced to them, and
// assertOwnedKey gates what they can then attach it to.
router.post(
  '/presign',
  requireAuth,
  uploadLimiter,
  validate({ body: presignSchema }),
  createPresignedUpload,
)

/*
  Read one object back: <img src="/api/uploads/{purpose}/{userId}/{uuid}.jpg">.
  Auth'd only — the controller explains the authorization model.

  The wildcard MUST be named (`/*key`) — Express 5 dropped the bare `*` path and
  throws at router-build time on it, so this would take the whole API down at boot
  rather than 404 at request time.

  No `validate()` here: the key isn't a body or a typed param, it's raw path text,
  and uploadService.parseKey is the one place that decides what a valid key is.
*/
router.get('/*key', requireAuth, getUpload)

export default router
