import { Router } from 'express'
import authRoutes from './auth.routes'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { validate } from '../middlewares/validate.middleware'
import { createOrganizerSchema } from '../validators/auth.validators'
import { createOrganizer } from '../controllers/auth.controllers'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

router.use('/auth', authRoutes)

// Organization-only: create an organizer. Authorization enforced server-side.
router.post(
  '/organizers',
  requireAuth,
  requireRole('organization'),
  validate({ body: createOrganizerSchema }),
  createOrganizer,
)

export default router
