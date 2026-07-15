import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import {
  createManagerSchema,
  updateManagerSchema,
  managerIdParam,
} from '../validators/managers.validators'
import {
  listManagers,
  createManager,
  updateManager,
  resendManagerInvite,
  removeManager,
} from '../controllers/managers.controllers'

// Every route is organization-only — this IS the guardrail: a manager cannot mint a
// peer manager (rank check fails, 403). Only the org (rank 4) provisions managers.
const router = Router()

router.use(requireAuth, requireRole('organization'))

router.get('/', listManagers)
router.post('/', validate({ body: createManagerSchema }), createManager)
router.patch('/:id', validate({ params: managerIdParam, body: updateManagerSchema }), updateManager)
router.post('/:id/resend', validate({ params: managerIdParam }), resendManagerInvite)
router.delete('/:id', validate({ params: managerIdParam }), removeManager)

export default router
