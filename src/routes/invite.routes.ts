import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { inviteTokenParam } from '../validators/invite.validators'
import { getInvite, acceptInvite } from '../controllers/invite.controllers'

// Public, token-gated: an invited organizer completes onboarding here without an
// existing session. Authorization is the unguessable token, not a role.
const router = Router()

router.get('/:token', validate({ params: inviteTokenParam }), getInvite)
// Accept carries NO body (the phone was recorded at invite time), so only the
// token param is validated — validating a body would reject the bodyless request.
router.post('/:token/accept', validate({ params: inviteTokenParam }), acceptInvite)

export default router
