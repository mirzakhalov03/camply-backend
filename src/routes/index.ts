import { Router } from 'express'
import authRoutes from './auth.routes'
import organizerRoutes from './organizer.routes'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

router.use('/auth', authRoutes)
router.use('/organizers', organizerRoutes)

export default router
