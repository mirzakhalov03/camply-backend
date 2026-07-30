import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth } from '../middlewares/auth.middleware'
import { requireCampMember, requireCampManager } from '../middlewares/campScope.middleware'
import {
  placeIdParams,
  createPlaceSchema,
  updatePlaceSchema,
  boundarySchema,
} from '../validators/place.validators'
import { campIdParam } from '../validators/camp.validators'
import * as c from '../controllers/place.controllers'

/*
  Manager-tier map authoring, mounted at /organizer/camps/:id/map.

  mergeParams so requireCampMember can read :id from the parent mount. The member-level
  READ (GET /camps/:id/map/places) lives on campRouter instead — places are camp-wide
  public, so a second manager-only list would be a duplicate of the same projection.
*/
const router = Router({ mergeParams: true })
router.use(requireAuth, requireCampMember, requireCampManager)

router.post('/places', validate({ params: campIdParam, body: createPlaceSchema }), c.createPlace)
router.patch(
  '/places/:pid',
  validate({ params: placeIdParams, body: updatePlaceSchema }),
  c.updatePlace,
)
router.delete('/places/:pid', validate({ params: placeIdParams }), c.removePlace)

// The camp's outer circle. PATCH with { boundary: null } clears it.
router.patch('/boundary', validate({ params: campIdParam, body: boundarySchema }), c.setBoundary)

export default router
