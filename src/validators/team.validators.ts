import { z } from '../config/zod'
import { ORGANIZER_SUB_ROLES } from '../models/membership.model'

// Guardrail: the 6 organizer sub-roles ONLY. A body trying to grant a peer
// 'organizer'/'organization' fails validation (400) — organizers can't mint peers.
//
// Derived from ORGANIZER_SUB_ROLES rather than retyped: this list used to carry a
// 7th value, 'projectManager', after that role was promoted to the first-class
// `manager` account role and dropped from MEMBERSHIP_ROLES. It passed validation
// and then blew up on the Mongoose enum — a 500 on a perfectly well-formed request.
// Sourcing it from the model makes that class of drift impossible.
const ROLE = z.enum(ORGANIZER_SUB_ROLES)

export const inviteTeamSchema = z.object({ phone: z.string().min(5), role: ROLE })
export const teamInviteIdParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
})
