import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth } from '../middlewares/auth.middleware'
import { requireCampMember, requireCampManager } from '../middlewares/campScope.middleware'
import { leaderboardParams, adjustPointsSchema } from '../validators/leaderboard.validators'
import * as c from '../controllers/leaderboard.controllers'

// mergeParams so requireCampMember reads :id from the parent /camps/:id mount.
// Standings are member-level; adjusting points is manager-only.
const router = Router({ mergeParams: true })
router.use(requireAuth, requireCampMember)
router.get('/', c.getLeaderboard)
router.post(
  '/:gid/points',
  requireCampManager,
  validate({ params: leaderboardParams, body: adjustPointsSchema }),
  c.adjustPoints,
)

export default router
