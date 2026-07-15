import { ORGANIZER_SUB_ROLES } from '../models/membership.model'
import {
  makeOnboardingService,
  type PublicOnboardingUser,
  type OnboardingStatus,
} from './onboarding.factory'

export type OrganizerStatus = OnboardingStatus
export type PublicOrganizer = PublicOnboardingUser

// Organizers own no 'manager' rows; purge their sub-role memberships on delete.
export const organizerService = makeOnboardingService({
  role: 'organizer',
  cleanupMembershipRoles: ORGANIZER_SUB_ROLES,
})
