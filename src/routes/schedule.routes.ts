import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth } from '../middlewares/auth.middleware'
import { requireCampMember, requireCampManager } from '../middlewares/campScope.middleware'
import {
  activityIdParams,
  createActivitySchema,
  updateActivitySchema,
} from '../validators/schedule.validators'
import { campIdParam } from '../validators/camp.validators'
import * as c from '../controllers/schedule.controllers'

// mergeParams so requireCampMember reads :id from the parent /camps/:id mount.
// Reads are member-level (participants included); writes are manager-only.
const router = Router({ mergeParams: true })
router.use(requireAuth, requireCampMember)
router.get('/', c.listSchedule)
router.post(
  '/',
  requireCampManager,
  validate({ params: campIdParam, body: createActivitySchema }),
  c.createActivity,
)
router.patch(
  '/:aid',
  requireCampManager,
  validate({ params: activityIdParams, body: updateActivitySchema }),
  c.updateActivity,
)
router.delete('/:aid', requireCampManager, validate({ params: activityIdParams }), c.deleteActivity)

export default router
