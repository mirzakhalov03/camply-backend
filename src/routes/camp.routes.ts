import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { requireCampMember, requireCampManager } from '../middlewares/campScope.middleware'
import { campIdParam, createCampSchema, updateCampSchema } from '../validators/camp.validators'
import * as c from '../controllers/camp.controllers'
import { getMyGroup, setMyGroupPhoto } from '../controllers/group.controllers'
import { myGroupPhotoSchema } from '../validators/group.validators'
import { getMapPlaces } from '../controllers/place.controllers'
import { getMapPins, setSharing } from '../controllers/location.controllers'
import { sharingSchema } from '../validators/location.validators'
import rosterRouter from './roster.routes'
import groupRouter from './group.routes'
import mapRouter from './place.routes'
import scheduleRouter from './schedule.routes'
import announcementRouter from './announcement.routes'
import leaderboardRouter from './leaderboard.routes'
import chatRouter from './chat.routes'

// Organizer management projection.
export const organizerCampRouter = Router()
organizerCampRouter.use(requireAuth, requireRole('organizer'))
organizerCampRouter.use('/camps/:id/roster', rosterRouter)
organizerCampRouter.use('/camps/:id/groups', groupRouter)
// Map AUTHORING (zones, landmarks, boundary) — manager-tier. The member-level read
// lives on campRouter below.
organizerCampRouter.use('/camps/:id/map', mapRouter)
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
/*
  Org-wide camp list — every camp in the caller's organization, across all its
  managers. ORGANIZATION ONLY: a manager sees their own camps via /organizer/camps,
  and this projection deliberately spans owners they have no authority over.
*/
campRouter.get('/', requireAuth, requireRole('organization'), c.listAllCamps)
campRouter.get('/:id', requireAuth, validate({ params: campIdParam }), requireCampMember, c.getCamp)
// The caller's own group — a member-level read, unlike the manager-gated
// /organizer/camps/:id/groups roster projection.
campRouter.get(
  '/:id/my-group',
  requireAuth,
  validate({ params: campIdParam }),
  requireCampMember,
  getMyGroup,
)
/*
  The group's identity photo, written by any MEMBER of that group — deliberately not
  under requireCampManager. The target group is the caller's own membership.groupId,
  so member-tier here cannot reach any other group (see setMyGroupPhoto).
*/
campRouter.patch(
  '/:id/my-group/photo',
  requireAuth,
  validate({ params: campIdParam, body: myGroupPhotoSchema }),
  requireCampMember,
  setMyGroupPhoto,
)
campRouter.get(
  '/:id/my-role',
  requireAuth,
  validate({ params: campIdParam }),
  requireCampMember,
  c.getMyRole,
)
/*
  The camp's STATIC map layer — boundary + zones + landmarks. Member-level, and
  deliberately the only read: a place carries no personal data and is camp-wide public,
  so a manager-only duplicate of this projection would earn nothing. Live participant
  pins are a separate, privacy-scoped resource (design §5, step 2).
*/
campRouter.get(
  '/:id/map/places',
  requireAuth,
  validate({ params: campIdParam }),
  requireCampMember,
  getMapPlaces,
)
/*
  Live pins — the PRIVACY-SCOPED read. Member-level, but what comes back depends on who
  is asking: a participant gets their own group, staff get the whole camp plus the
  coordinate-free `hidden[]`. The scoping lives in the service, not here.
*/
campRouter.get(
  '/:id/map/pins',
  requireAuth,
  validate({ params: campIdParam }),
  requireCampMember,
  getMapPins,
)
/*
  The caller's OWN sharing toggle. No user id in the body — the target is always the
  authenticated caller, so there is no parameter to aim at someone else.
*/
campRouter.patch(
  '/:id/my-location-sharing',
  requireAuth,
  validate({ params: campIdParam, body: sharingSchema }),
  requireCampMember,
  setSharing,
)
campRouter.use('/:id/schedule', scheduleRouter)
campRouter.use('/:id/announcements', announcementRouter)
campRouter.use('/:id/leaderboard', leaderboardRouter)
campRouter.use('/:id/chat', chatRouter)
