import { z } from '../config/zod'

// Guardrail: the 7 organizer sub-roles ONLY. A body trying to grant a peer
// 'organizer'/'organization' fails validation (400) — organizers can't mint peers.
const ROLE = z.enum([
  'projectManager',
  'coordinator',
  'admin',
  'media',
  'brandFace',
  'eventManager',
  'photographer',
])

export const inviteTeamSchema = z.object({ phone: z.string().min(5), role: ROLE })
export const teamInviteIdParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
})
