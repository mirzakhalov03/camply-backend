import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware'
import { requireCampMember, requireCampManager } from '../middlewares/campScope.middleware'
import { validate } from '../middlewares/validate.middleware'
import { campIdParam } from '../validators/camp.validators'
import * as c from '../controllers/chat.controllers'

// mergeParams so the campScope middleware can read :id from the parent campRouter.
const router = Router({ mergeParams: true })

router.get(
  '/group/messages',
  requireAuth,
  validate({ params: campIdParam }),
  requireCampMember,
  c.getGroupMessages,
)
router.get(
  '/organizers/messages',
  requireAuth,
  validate({ params: campIdParam }),
  requireCampMember,
  requireCampManager,
  c.getOrganizerMessages,
)

export default router
