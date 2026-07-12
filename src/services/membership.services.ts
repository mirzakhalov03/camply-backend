import { MembershipModel } from '../models/membership.model'

export const membershipService = {
  // On login, attach any pending memberships for this phone to the user. Additive
  // and idempotent: it only touches rows not yet bound (userId: null), so re-running
  // on every login is a no-op once bound.
  bindPhone: async (userId: unknown, phone: string): Promise<void> => {
    await MembershipModel.updateMany(
      { phone, userId: null },
      { $set: { userId, status: 'active' } },
    )
  },

  // ≤2-camps rule: how many participant camps this phone already holds.
  countParticipantCamps: async (phone: string): Promise<number> =>
    MembershipModel.countDocuments({ phone, role: 'participant' }),
}
