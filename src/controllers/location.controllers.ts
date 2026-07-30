import type { RequestHandler } from 'express'
import { locationService } from '../services/location.services'
import { ORGANIZER_SUB_ROLES } from '../models/membership.model'

/*
  "Staff" for map purposes = anyone entitled to see the WHOLE camp: the account-level
  organization or manager, or a camp membership at manager/organizer tier. A coordinator
  IS organizer-tier and therefore staff (design §5.1) — they also sit in their own
  group's room, which is a strict subset.
*/
export function isStaffMembership(
  membershipRole: string | undefined,
  accountRole: string | undefined,
): boolean {
  if (accountRole === 'organization' || accountRole === 'manager') return true
  if (!membershipRole) return false
  return (
    membershipRole === 'manager' ||
    (ORGANIZER_SUB_ROLES as readonly string[]).includes(membershipRole)
  )
}

export const getMapPins: RequestHandler = async (req, res) => {
  const isStaff = isStaffMembership(req.membership?.role, req.auth!.user.role)
  res.json(
    await locationService.pinsFor(
      req.camp!,
      { userId: req.auth!.user._id, groupId: req.membership?.groupId ?? null },
      isStaff,
    ),
  )
}

export const setSharing: RequestHandler = async (req, res) => {
  res.json(await locationService.setSharing(req.camp!._id, req.auth!.user._id, req.body.enabled))
}
