import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../middlewares/auth.middleware'
import { validate } from '../middlewares/validate.middleware'
import { presignSchema } from '../validators/upload.validators'
import { createPresignedUpload } from '../controllers/upload.controllers'

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

export default router
