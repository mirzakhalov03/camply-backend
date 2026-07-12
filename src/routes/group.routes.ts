import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth } from '../middlewares/auth.middleware'
import { requireCampMember, requireCampManager } from '../middlewares/campScope.middleware'
import { groupIdParams, createGroupSchema, updateGroupSchema } from '../validators/group.validators'
import { campIdParam } from '../validators/camp.validators'
import * as c from '../controllers/group.controllers'

// mergeParams so requireCampMember can read :id from the parent /camps/:id mount.
const router = Router({ mergeParams: true })
router.use(requireAuth, requireCampMember, requireCampManager)
router.get('/', c.listGroups)
router.post('/', validate({ params: campIdParam, body: createGroupSchema }), c.createGroup)
router.patch('/:gid', validate({ params: groupIdParams, body: updateGroupSchema }), c.updateGroup)
router.delete('/:gid', validate({ params: groupIdParams }), c.removeGroup)

export default router
