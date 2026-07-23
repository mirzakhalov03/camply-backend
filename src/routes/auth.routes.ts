import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth } from '../middlewares/auth.middleware'
import {
  loginSchema,
  completeProfileSchema,
  setLanguageSchema,
} from '../validators/auth.validators'
import {
  login,
  me,
  logout,
  logoutAll,
  completeProfile,
  setLanguage,
} from '../controllers/auth.controllers'

// Blunt brute-force / phone enumeration on the credential-less participant flow.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again later' },
})

const router = Router()

router.post('/login', authLimiter, validate({ body: loginSchema }), login)
router.get('/me', requireAuth, me)
router.patch('/me', requireAuth, validate({ body: completeProfileSchema }), completeProfile)
router.patch('/me/language', requireAuth, validate({ body: setLanguageSchema }), setLanguage)
router.post('/logout', requireAuth, logout)
router.post('/logout-all', requireAuth, logoutAll)

export default router
