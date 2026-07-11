import { Router } from 'express'
import authRoutes from './auth.routes'
import organizerRoutes from './organizer.routes'
import inviteRoutes from './invite.routes'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

router.use('/auth', authRoutes)
router.use('/organizers', organizerRoutes)
router.use('/invite', inviteRoutes)

export default router
