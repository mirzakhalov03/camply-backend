import { Router } from 'express'
import authRoutes from './auth.routes'
import organizerRoutes from './organizer.routes'
import inviteRoutes from './invite.routes'
import { organizerCampRouter, campRouter } from './camp.routes'
import teamRoutes from './team.routes'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

router.use('/auth', authRoutes)
router.use('/organizers', organizerRoutes)
router.use('/invite', inviteRoutes)
// Mount the specific /organizer/team before the broader /organizer camp router so
// it's handled directly (no redundant pass through the camp router's middleware).
router.use('/organizer/team', teamRoutes)
router.use('/organizer', organizerCampRouter)
router.use('/camps', campRouter)

export default router
