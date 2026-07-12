import type { RequestHandler } from 'express'
import { CampModel } from '../models/camp.model'
import { MembershipModel, ORGANIZER_SUB_ROLES } from '../models/membership.model'
import { HttpError } from './error.middleware'

const isOrganizerTier = (role: string): boolean =>
  (ORGANIZER_SUB_ROLES as readonly string[]).includes(role)

// AUTHORIZATION (camp scope) — "may you touch THIS camp?". Compose AFTER requireAuth.
// Loads the camp + the caller's membership, attaches both. Reads use this.
export const requireCampMember: RequestHandler = async (req, _res, next) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated')
  const campId = req.params.id ?? req.params.campId
  const camp = await CampModel.findById(campId)
  if (!camp) throw new HttpError(404, 'Camp not found')

  const { user } = req.auth
  // The organization super-admin sees any camp in its org.
  if (user.role === 'organization') {
    if (String(camp.organizationId) !== String(user._id)) {
      throw new HttpError(403, 'Not your camp')
    }
    req.camp = camp
    req.membership = null
    return next()
  }

  const membership = await MembershipModel.findOne({ campId: camp._id, userId: user._id })
  if (!membership) throw new HttpError(403, 'Not a member of this camp')
  req.camp = camp
  req.membership = membership
  next()
}

// Writes use this — organizer-tier membership, the org, or the camp creator.
export const requireCampManager: RequestHandler = (req, _res, next) => {
  if (!req.camp || !req.auth) throw new HttpError(401, 'Not authenticated')
  const { user } = req.auth
  const isOrg = user.role === 'organization'
  const isCreator = String(req.camp.createdBy) === String(user._id)
  const isManager = req.membership != null && isOrganizerTier(req.membership.role)
  if (!isOrg && !isCreator && !isManager) throw new HttpError(403, 'Insufficient permissions')
  next()
}
