import { Router } from 'express'
import authRoutes from './auth.routes'
import organizerRoutes from './organizer.routes'
import managerRoutes from './managers.routes'
import inviteRoutes from './invite.routes'
import meRoutes from './me.routes'
import { organizerCampRouter, campRouter } from './camp.routes'
import teamRoutes from './team.routes'
import uploadRoutes from './upload.routes'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

router.use('/auth', authRoutes)
router.use('/organizers', organizerRoutes)
router.use('/managers', managerRoutes)
router.use('/invite', inviteRoutes)
router.use('/me', meRoutes)
router.use('/uploads', uploadRoutes)
// Mount the specific /organizer/team before the broader /organizer camp router so
// it's handled directly (no redundant pass through the camp router's middleware).
router.use('/organizer/team', teamRoutes)
router.use('/organizer', organizerCampRouter)
router.use('/camps', campRouter)

export default router
