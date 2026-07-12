import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { inviteTeamSchema, teamInviteIdParam } from '../validators/team.validators'
import * as c from '../controllers/team.controllers'

// Org-level (cross-camp), organizer-only. Sub-role guardrail lives in the validator.
const router = Router()
router.use(requireAuth, requireRole('organizer'))
router.get('/', c.getTeam)
router.post('/invites', validate({ body: inviteTeamSchema }), c.inviteTeammate)
router.delete('/invites/:id', validate({ params: teamInviteIdParam }), c.cancelTeamInvite)

export default router
