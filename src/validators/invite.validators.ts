import { z } from '../config/zod'

// 9 national digits — matches the frontend PHONE_LENGTH and auth.validators.
const phone = z.string().regex(/^\d{9}$/, 'Phone must be 9 digits')

export const acceptInviteSchema = z.object({ phone })

export const inviteTokenParam = z.object({
  token: z.string().min(20, 'Invalid token'),
})

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>
