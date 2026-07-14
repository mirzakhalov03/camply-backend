import { z } from '../config/zod'

// Accept carries no body (the phone was recorded by the org at invite time), so
// only the token param is validated — see invite.routes.ts.
export const inviteTokenParam = z.object({
  token: z.string().min(20, 'Invalid token'),
})
