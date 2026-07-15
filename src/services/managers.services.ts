import { makeOnboardingService, type PublicOnboardingUser } from './onboarding.factory'

export type PublicManager = PublicOnboardingUser

// A manager's own per-camp row is role 'manager'; purge it on delete.
export const managerService = makeOnboardingService({
  role: 'manager',
  cleanupMembershipRoles: ['manager'],
})
