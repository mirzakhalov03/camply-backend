import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { requireCampMember, requireCampManager } from '../middlewares/campScope.middleware'
import { campIdParam, createCampSchema, updateCampSchema } from '../validators/camp.validators'
import * as c from '../controllers/camp.controllers'
import rosterRouter from './roster.routes'
import groupRouter from './group.routes'
import scheduleRouter from './schedule.routes'
import announcementRouter from './announcement.routes'
import leaderboardRouter from './leaderboard.routes'

// Organizer management projection.
export const organizerCampRouter = Router()
organizerCampRouter.use(requireAuth, requireRole('organizer'))
organizerCampRouter.use('/camps/:id/roster', rosterRouter)
organizerCampRouter.use('/camps/:id/groups', groupRouter)
organizerCampRouter.get('/camps', c.listCamps)
organizerCampRouter.get('/summary', c.getCampSummary)
organizerCampRouter.post(
  '/camps',
  requireRole('manager'),
  validate({ body: createCampSchema }),
  c.createCamp,
)
organizerCampRouter.get(
  '/camps/:id',
  validate({ params: campIdParam }),
  requireCampMember,
  requireCampManager,
  c.getCamp,
)
organizerCampRouter.patch(
  '/camps/:id',
  validate({ params: campIdParam, body: updateCampSchema }),
  requireCampMember,
  requireCampManager,
  c.updateCamp,
)
organizerCampRouter.post(
  '/camps/:id/publish',
  validate({ params: campIdParam }),
  requireCampMember,
  requireCampManager,
  c.publishCamp,
)
organizerCampRouter.post(
  '/camps/:id/archive',
  validate({ params: campIdParam }),
  requireCampMember,
  requireCampManager,
  c.archiveCamp,
)
organizerCampRouter.delete(
  '/camps/:id',
  validate({ params: campIdParam }),
  requireCampMember,
  requireCampManager,
  c.deleteCamp,
)

// Shared read projection (participants included).
export const campRouter = Router()
campRouter.get('/:id', requireAuth, validate({ params: campIdParam }), requireCampMember, c.getCamp)
campRouter.use('/:id/schedule', scheduleRouter)
campRouter.use('/:id/announcements', announcementRouter)
campRouter.use('/:id/leaderboard', leaderboardRouter)
