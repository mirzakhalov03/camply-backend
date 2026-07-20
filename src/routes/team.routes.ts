import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { inviteTeamSchema, teamInviteIdParam } from '../validators/team.validators'
import * as c from '../controllers/team.controllers'

/*
  Org-level (cross-camp). READING the roster is organizer-tier — the Team tab is a
  destination for every organizer. WRITING is manager-tier: only managers and the org
  mint organizers (root guardrail), so an organizer can't invite a peer or cancel
  someone else's invite. Sub-role guardrail lives in the validator.
*/
const router = Router()
router.use(requireAuth, requireRole('organizer'))
router.get('/', c.getTeam)
router.post(
  '/invites',
  requireRole('manager'),
  validate({ body: inviteTeamSchema }),
  c.inviteTeammate,
)
router.delete(
  '/invites/:id',
  requireRole('manager'),
  validate({ params: teamInviteIdParam }),
  c.cancelTeamInvite,
)

export default router
