import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth } from '../middlewares/auth.middleware'
import { requireCampMember, requireCampManager } from '../middlewares/campScope.middleware'
import {
  announcementIdParams,
  createAnnouncementSchema,
  updateAnnouncementSchema,
  pinSchema,
} from '../validators/announcement.validators'
import { campIdParam } from '../validators/camp.validators'
import * as c from '../controllers/announcement.controllers'

// mergeParams so requireCampMember reads :id from the parent /camps/:id mount.
// Reads are member-level; writes are manager-only.
const router = Router({ mergeParams: true })
router.use(requireAuth, requireCampMember)
router.get('/', c.listAnnouncements)
router.get('/:aid', validate({ params: announcementIdParams }), c.getAnnouncement)
router.post(
  '/',
  requireCampManager,
  validate({ params: campIdParam, body: createAnnouncementSchema }),
  c.createAnnouncement,
)
router.patch(
  '/:aid',
  requireCampManager,
  validate({ params: announcementIdParams, body: updateAnnouncementSchema }),
  c.updateAnnouncement,
)
router.patch(
  '/:aid/pin',
  requireCampManager,
  validate({ params: announcementIdParams, body: pinSchema }),
  c.pinAnnouncement,
)
router.delete(
  '/:aid',
  requireCampManager,
  validate({ params: announcementIdParams }),
  c.deleteAnnouncement,
)

export default router
