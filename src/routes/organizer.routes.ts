import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import {
  createOrganizerSchema,
  updateOrganizerSchema,
  organizerIdParam,
} from '../validators/organizer.validators'
import {
  listOrganizers,
  createOrganizer,
  updateOrganizer,
  resendInvite,
  removeOrganizer,
} from '../controllers/organizer.controllers'

// Every route is organization-only. Authorization enforced server-side.
const router = Router()

router.use(requireAuth, requireRole('organization'))

router.get('/', listOrganizers)
router.post('/', validate({ body: createOrganizerSchema }), createOrganizer)
router.patch(
  '/:id',
  validate({ params: organizerIdParam, body: updateOrganizerSchema }),
  updateOrganizer,
)
router.post('/:id/resend', validate({ params: organizerIdParam }), resendInvite)
router.delete('/:id', validate({ params: organizerIdParam }), removeOrganizer)

export default router
