import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth } from '../middlewares/auth.middleware'
import { requireCampMember, requireCampManager } from '../middlewares/campScope.middleware'
import {
  rosterIdParams,
  addRosterSchema,
  updateRosterSchema,
} from '../validators/roster.validators'
import { campIdParam } from '../validators/camp.validators'
import * as c from '../controllers/roster.controllers'

// mergeParams so requireCampMember can read :id from the parent /camps/:id mount.
const router = Router({ mergeParams: true })
router.use(requireAuth, requireCampMember, requireCampManager)
router.get('/', c.listRoster)
router.post('/', validate({ params: campIdParam, body: addRosterSchema }), c.addRoster)
router.patch(
  '/:mid',
  validate({ params: rosterIdParams, body: updateRosterSchema }),
  c.updateRoster,
)
router.delete('/:mid', validate({ params: rosterIdParams }), c.removeRoster)

export default router
