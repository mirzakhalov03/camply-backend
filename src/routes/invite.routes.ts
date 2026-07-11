import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { acceptInviteSchema, inviteTokenParam } from '../validators/invite.validators'
import { getInvite, acceptInvite } from '../controllers/invite.controllers'

// Public, token-gated: an invited organizer completes onboarding here without an
// existing session. Authorization is the unguessable token, not a role.
const router = Router()

router.get('/:token', validate({ params: inviteTokenParam }), getInvite)
router.post(
  '/:token/accept',
  validate({ params: inviteTokenParam, body: acceptInviteSchema }),
  acceptInvite,
)

export default router
