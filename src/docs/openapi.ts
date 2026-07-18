import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { z } from '../config/zod'
import { loginSchema, completeProfileSchema } from '../validators/auth.validators'
import {
  createOrganizerSchema,
  updateOrganizerSchema,
  organizerIdParam,
} from '../validators/organizer.validators'
import {
  createManagerSchema,
  updateManagerSchema,
  managerIdParam,
} from '../validators/managers.validators'
import { createCampObject, updateCampSchema, campIdParam } from '../validators/camp.validators'
import {
  rosterIdParams,
  addRosterSchema,
  updateRosterSchema,
  checkinSchema,
} from '../validators/roster.validators'
import { groupIdParams, createGroupSchema, updateGroupSchema } from '../validators/group.validators'
import {
  activityIdParams,
  createActivitySchema,
  updateActivitySchema,
} from '../validators/schedule.validators'
import {
  announcementIdParams,
  createAnnouncementSchema,
  updateAnnouncementSchema,
  pinSchema,
} from '../validators/announcement.validators'
import { leaderboardParams, adjustPointsSchema } from '../validators/leaderboard.validators'
import { inviteTeamSchema, teamInviteIdParam } from '../validators/team.validators'

const registry = new OpenAPIRegistry()

// ── Reusable component schemas ────────────────────────────────────────────
const PublicUserSchema = registry.register(
  'PublicUser',
  z.object({
    id: z.string().openapi({ example: '665f1b2c9d1e4a0012a3b4c5' }),
    phone: z.string().nullable().openapi({ example: '+998901234567' }),
    name: z.string().openapi({ example: 'Ali' }),
    surname: z.string().openapi({ example: 'Valiyev' }),
    role: z
      .enum(['participant', 'organizer', 'manager', 'organization'])
      .openapi({ example: 'participant' }),
    cityId: z.string().nullable().openapi({ example: 'Tashkent' }),
    age: z.number().nullable().openapi({ example: 16 }),
    photo: z.string().nullable().openapi({ example: null }),
    subRole: z.string().nullable().openapi({ example: null }),
    profileComplete: z.boolean().openapi({ example: false }),
  }),
)

const SessionResponse = z.object({ user: PublicUserSchema })

const LoginInput = registry.register('LoginInput', loginSchema)
const CreateOrganizerInput = registry.register('CreateOrganizerInput', createOrganizerSchema)
const UpdateOrganizerInput = registry.register('UpdateOrganizerInput', updateOrganizerSchema)
const CompleteProfileInput = registry.register('CompleteProfileInput', completeProfileSchema)

const PublicOrganizerSchema = registry.register(
  'PublicOrganizer',
  z.object({
    id: z.string().openapi({ example: '665f1b2c9d1e4a0012a3b4c5' }),
    email: z.string().nullable().openapi({ example: 'aziz@example.com' }),
    phone: z.string().nullable().openapi({ example: '+998901234567' }),
    name: z.string().openapi({ example: 'Aziz' }),
    surname: z.string().openapi({ example: 'Karimov' }),
    status: z.enum(['pending', 'active', 'deactivated']).openapi({ example: 'pending' }),
    createdAt: z.string().openapi({ example: '2026-07-12T10:00:00.000Z' }),
  }),
)
const OrganizerResponse = z.object({ organizer: PublicOrganizerSchema })
const OrganizersListResponse = z.object({ organizers: z.array(PublicOrganizerSchema) })
// Create/resend also return the dev-only invite link so the org can test without an inbox.
const InviteActionResponse = z.object({
  organizer: PublicOrganizerSchema,
  inviteUrl: z.string().optional().openapi({ example: 'http://localhost:5173/invite/abc123' }),
})

// Managers mirror organizers (same public shape); only the response envelope key differs.
const CreateManagerInput = registry.register('CreateManagerInput', createManagerSchema)
const UpdateManagerInput = registry.register('UpdateManagerInput', updateManagerSchema)
const PublicManagerSchema = registry.register(
  'PublicManager',
  z.object({
    id: z.string().openapi({ example: '665f1b2c9d1e4a0012a3b4c5' }),
    email: z.string().nullable().openapi({ example: 'aziz@example.com' }),
    phone: z.string().nullable().openapi({ example: '+998901234567' }),
    name: z.string().openapi({ example: 'Aziz' }),
    surname: z.string().openapi({ example: 'Karimov' }),
    status: z.enum(['pending', 'active', 'deactivated']).openapi({ example: 'pending' }),
    createdAt: z.string().openapi({ example: '2026-07-12T10:00:00.000Z' }),
  }),
)
const ManagerResponse = z.object({ manager: PublicManagerSchema })
const ManagersListResponse = z.object({ managers: z.array(PublicManagerSchema) })
const ManagerInviteActionResponse = z.object({
  manager: PublicManagerSchema,
  inviteUrl: z.string().optional().openapi({ example: 'http://localhost:5173/invite/abc123' }),
})

// ── Camp schemas ──────────────────────────────────────────────────────────
const CreateCampInput = registry.register('CreateCampInput', createCampObject)
const UpdateCampInput = registry.register('UpdateCampInput', updateCampSchema)

const OrganizerCampSchema = registry.register(
  'OrganizerCamp',
  z.object({
    id: z.string(),
    name: z.string().openapi({ example: 'Summer Leadership Camp' }),
    location: z.string().openapi({ example: 'Chimgan' }),
    dateRange: z.string().openapi({ example: 'Jul 6 – Jul 19' }),
    status: z.enum(['active', 'upcoming', 'draft', 'archived']),
    participantCount: z.number(),
    groupCount: z.number(),
    organizerCount: z.number(),
    checkinPct: z.number(),
    dayCurrent: z.number(),
    dayTotal: z.number(),
    coverImage: z.string().nullable(),
  }),
)
// The participant's slice of a camp — same entity as OrganizerCamp, minus every
// roster count. Participants get headline info, not back-office totals.
const ParticipantCampSchema = registry.register(
  'ParticipantCamp',
  z.object({
    id: z.string(),
    name: z.string().openapi({ example: 'Summer Leadership Camp' }),
    location: z.string().openapi({ example: 'Chimgan' }),
    dateRange: z.string().openapi({ example: 'Jul 6 – Jul 19' }),
    startsAt: z.string(),
    endsAt: z.string(),
    status: z.enum(['active', 'upcoming', 'archived']),
    coverImage: z.string().nullable(),
    dayCurrent: z.number().openapi({ example: 6 }),
    dayTotal: z.number().openapi({ example: 14 }),
  }),
)

// A member of your own group: initials and a color, never a name or phone.
const MyGroupSchema = registry.register(
  'MyGroup',
  z.object({
    id: z.string(),
    name: z.string().openapi({ example: 'Pine Wolves' }),
    color: z.string().openapi({ example: '#0f6b4f' }),
    photo: z.string().nullable(),
    memberCount: z.number(),
    members: z.array(
      z.object({
        initials: z.string().openapi({ example: 'JM' }),
        color: z.string().openapi({ example: 'sky' }),
      }),
    ),
  }),
)

const OrganizerSummarySchema = registry.register(
  'OrganizerSummary',
  z.object({
    organizerName: z.string(),
    organizationName: z.string(),
    totalParticipants: z.number(),
    activeCamps: z.number(),
    totalGroups: z.number(),
    unreadChat: z.number(),
    onSite: z.number(),
  }),
)

// ── Paths ─────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get',
  path: '/api/health',
  tags: ['System'],
  summary: 'Health check',
  responses: {
    200: {
      description: 'Service is up',
      content: {
        'application/json': { schema: z.object({ status: z.string(), uptime: z.number() }) },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  tags: ['Auth'],
  summary: 'Log in (participant: phone; organizer: phone + password; org: username + password)',
  request: { body: { content: { 'application/json': { schema: LoginInput } } } },
  responses: {
    200: {
      description: 'Session started; sets the camply_sid cookie',
      content: { 'application/json': { schema: SessionResponse } },
    },
    401: { description: 'Invalid credentials' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  tags: ['Auth'],
  summary: 'The authenticated user',
  responses: {
    200: {
      description: 'Current user',
      content: { 'application/json': { schema: PublicUserSchema } },
    },
    401: { description: 'Not authenticated' },
  },
})

registry.registerPath({
  method: 'patch',
  path: '/api/auth/me',
  tags: ['Auth'],
  summary: 'Complete the authenticated participant profile',
  request: { body: { content: { 'application/json': { schema: CompleteProfileInput } } } },
  responses: {
    200: {
      description: 'Updated user',
      content: { 'application/json': { schema: PublicUserSchema } },
    },
    400: { description: 'Validation failed' },
    401: { description: 'Not authenticated' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  tags: ['Auth'],
  summary: 'Log out this session',
  responses: { 204: { description: 'Logged out' }, 401: { description: 'Not authenticated' } },
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/logout-all',
  tags: ['Auth'],
  summary: 'Log out every session for this user',
  responses: {
    204: { description: 'Logged out everywhere' },
    401: { description: 'Not authenticated' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/organizers',
  tags: ['Organizers'],
  summary: 'List all organizers (organization only)',
  responses: {
    200: {
      description: 'Organizers, newest first',
      content: { 'application/json': { schema: OrganizersListResponse } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/organizers',
  tags: ['Organizers'],
  summary: 'Invite an organizer by name, email + phone (organization only)',
  request: { body: { content: { 'application/json': { schema: CreateOrganizerInput } } } },
  responses: {
    201: {
      description: 'Pending organizer created; invite emailed (inviteUrl returned in dev)',
      content: { 'application/json': { schema: InviteActionResponse } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    409: { description: 'Email already registered' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/organizers/{id}/resend',
  tags: ['Organizers'],
  summary: 'Resend a pending organizer invite (organization only)',
  request: { params: organizerIdParam },
  responses: {
    200: {
      description: 'Invite re-issued and emailed (inviteUrl returned in dev)',
      content: { 'application/json': { schema: InviteActionResponse } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    404: { description: 'Organizer not found' },
    409: { description: 'Organizer already active' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/api/organizers/{id}',
  tags: ['Organizers'],
  summary:
    'Delete an organizer — revokes a pending invite, or hard-deletes a deactivated one (organization only)',
  request: { params: organizerIdParam },
  responses: {
    204: { description: 'Organizer deleted' },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    404: { description: 'Organizer not found' },
    409: { description: 'Organizer still active — deactivate before deleting' },
  },
})

registry.registerPath({
  method: 'patch',
  path: '/api/organizers/{id}',
  tags: ['Organizers'],
  summary: 'Activate or deactivate an organizer (organization only)',
  request: {
    params: organizerIdParam,
    body: { content: { 'application/json': { schema: UpdateOrganizerInput } } },
  },
  responses: {
    200: {
      description: 'Updated organizer',
      content: { 'application/json': { schema: OrganizerResponse } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    404: { description: 'Organizer not found' },
  },
})

// ── Managers (organization only — a manager cannot mint a peer manager) ──────
registry.registerPath({
  method: 'get',
  path: '/api/managers',
  tags: ['Managers'],
  summary: 'List all managers (organization only)',
  responses: {
    200: {
      description: 'Managers, newest first',
      content: { 'application/json': { schema: ManagersListResponse } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/managers',
  tags: ['Managers'],
  summary: 'Invite a manager by name, email + phone (organization only)',
  request: { body: { content: { 'application/json': { schema: CreateManagerInput } } } },
  responses: {
    201: {
      description: 'Pending manager created; invite emailed (inviteUrl returned in dev)',
      content: { 'application/json': { schema: ManagerInviteActionResponse } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    409: { description: 'Email already registered' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/managers/{id}/resend',
  tags: ['Managers'],
  summary: 'Resend a pending manager invite (organization only)',
  request: { params: managerIdParam },
  responses: {
    200: {
      description: 'Invite re-issued and emailed (inviteUrl returned in dev)',
      content: { 'application/json': { schema: ManagerInviteActionResponse } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    404: { description: 'Manager not found' },
    409: { description: 'Manager already active' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/api/managers/{id}',
  tags: ['Managers'],
  summary:
    'Delete a manager — revokes a pending invite, or hard-deletes a deactivated one (organization only)',
  request: { params: managerIdParam },
  responses: {
    204: { description: 'Manager deleted' },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    404: { description: 'Manager not found' },
    409: { description: 'Manager still active — deactivate before deleting' },
  },
})

registry.registerPath({
  method: 'patch',
  path: '/api/managers/{id}',
  tags: ['Managers'],
  summary: 'Activate or deactivate a manager (organization only)',
  request: {
    params: managerIdParam,
    body: { content: { 'application/json': { schema: UpdateManagerInput } } },
  },
  responses: {
    200: {
      description: 'Updated manager',
      content: { 'application/json': { schema: ManagerResponse } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    404: { description: 'Manager not found' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/invite/{token}',
  tags: ['Invite'],
  summary: 'Public: fetch an organizer invite for the accept screen',
  responses: {
    200: {
      description: 'Invitee name + email',
      content: {
        'application/json': { schema: z.object({ name: z.string(), email: z.string() }) },
      },
    },
    404: { description: 'Invalid invite' },
    410: { description: 'Invite expired' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/invite/{token}/accept',
  tags: ['Invite'],
  summary: 'Public: accept an invite (no body — phone set at invite time); starts a session',
  responses: {
    200: { description: 'Accepted; sets the camply_sid cookie' },
    404: { description: 'Invalid invite' },
    410: { description: 'Invite expired' },
  },
})

// ── Camps ───────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get',
  path: '/api/organizer/camps',
  tags: ['Camps'],
  summary: 'List the camps the organizer runs (newest first)',
  responses: {
    200: {
      description: 'Organizer camps',
      content: { 'application/json': { schema: z.array(OrganizerCampSchema) } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/organizer/summary',
  tags: ['Camps'],
  summary: 'Cross-camp totals for the organizer dashboard header',
  responses: {
    200: {
      description: 'Summary totals',
      content: { 'application/json': { schema: OrganizerSummarySchema } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/organizer/camps',
  tags: ['Camps'],
  summary: 'Create a camp, optionally with groups + participants (batch)',
  request: { body: { content: { 'application/json': { schema: CreateCampInput } } } },
  responses: {
    201: {
      description: 'Created camp',
      content: { 'application/json': { schema: OrganizerCampSchema } },
    },
    200: {
      description: 'Existing camp (clientRequestId dedupe hit)',
      content: { 'application/json': { schema: OrganizerCampSchema } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    409: {
      description:
        'Limit reached — an organizer may create only one camp (participant already in 2 camps, or duplicate phone)',
    },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/organizer/camps/{id}',
  tags: ['Camps'],
  summary: 'One camp (management projection)',
  request: { params: campIdParam },
  responses: {
    200: {
      description: 'Camp',
      content: { 'application/json': { schema: OrganizerCampSchema } },
    },
    403: { description: 'Not a manager of this camp' },
    404: { description: 'Camp not found' },
  },
})
registry.registerPath({
  method: 'patch',
  path: '/api/organizer/camps/{id}',
  tags: ['Camps'],
  summary: 'Edit a camp',
  request: {
    params: campIdParam,
    body: { content: { 'application/json': { schema: UpdateCampInput } } },
  },
  responses: {
    200: {
      description: 'Updated camp',
      content: { 'application/json': { schema: OrganizerCampSchema } },
    },
    403: { description: 'Not a manager of this camp' },
    404: { description: 'Camp not found' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/organizer/camps/{id}/publish',
  tags: ['Camps'],
  summary: 'Publish a draft camp',
  request: { params: campIdParam },
  responses: {
    200: {
      description: 'Published camp',
      content: { 'application/json': { schema: OrganizerCampSchema } },
    },
    403: { description: 'Not a manager of this camp' },
    404: { description: 'Camp not found' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/organizer/camps/{id}/archive',
  tags: ['Camps'],
  summary: 'Manually archive a camp',
  request: { params: campIdParam },
  responses: {
    200: {
      description: 'Archived camp',
      content: { 'application/json': { schema: OrganizerCampSchema } },
    },
    403: { description: 'Not a manager of this camp' },
    404: { description: 'Camp not found' },
  },
})
registry.registerPath({
  method: 'delete',
  path: '/api/organizer/camps/{id}',
  tags: ['Camps'],
  summary: 'Delete a camp (only while draft)',
  request: { params: campIdParam },
  responses: {
    204: { description: 'Deleted' },
    403: { description: 'Not a manager of this camp' },
    404: { description: 'Camp not found' },
    409: { description: 'Only draft camps can be deleted' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}',
  tags: ['Camps'],
  summary: 'One camp (shared read projection — participants included)',
  request: { params: campIdParam },
  responses: {
    200: {
      description: 'Camp',
      content: { 'application/json': { schema: OrganizerCampSchema } },
    },
    403: { description: 'Not a member of this camp' },
    404: { description: 'Camp not found' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/me/camps',
  tags: ['Me'],
  summary: "The caller's own camps",
  description:
    'Self-scoped: requireAuth only, no role gate. Returns every published, not-yet-finished camp the caller participates in, most relevant first (running now, then soonest upcoming). Draft and archived camps are excluded. An empty array is a valid response and means the client should show its no-camp state.',
  responses: {
    200: {
      description: 'Camps the caller participates in',
      content: { 'application/json': { schema: z.array(ParticipantCampSchema) } },
    },
    401: { description: 'Not authenticated' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}/my-group',
  tags: ['Camps'],
  summary: "The caller's own group within a camp",
  description:
    "Member-level read. Returns only initials and a color per member — never another member's name or phone. `group` is null (with 200) when the caller has not been assigned to a group yet.",
  request: { params: campIdParam },
  responses: {
    200: {
      description: "The caller's group, or null when unassigned",
      content: {
        'application/json': { schema: z.object({ group: MyGroupSchema.nullable() }) },
      },
    },
    403: { description: 'Not a member of this camp' },
    404: { description: 'Camp not found' },
  },
})

// ── Roster ──────────────────────────────────────────────────────────────
const RosterParticipantSchema = registry.register(
  'RosterParticipant',
  z.object({
    id: z.string(),
    name: z.string(),
    initials: z.string(),
    avatarColor: z.string(),
    photo: z.string().nullable(),
    groupId: z.string().nullable(),
    groupName: z.string().nullable(),
    city: z.string(),
    age: z.number(),
    status: z.enum(['in', 'out']),
    phone: z.string(),
  }),
)
const AddRosterInput = registry.register('AddRosterInput', addRosterSchema)
const UpdateRosterInput = registry.register('UpdateRosterInput', updateRosterSchema)
const CheckinInput = registry.register('CheckinInput', checkinSchema)

registry.registerPath({
  method: 'get',
  path: '/api/organizer/camps/{id}/roster',
  tags: ['Roster'],
  summary: 'The camp roster (participants, alphabetical)',
  request: { params: campIdParam },
  responses: {
    200: {
      description: 'Roster rows',
      content: { 'application/json': { schema: z.array(RosterParticipantSchema) } },
    },
    403: { description: 'Not a manager of this camp' },
    404: { description: 'Camp not found' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/organizer/camps/{id}/roster',
  tags: ['Roster'],
  summary: 'Add a participant by phone (≤2 camps enforced)',
  request: {
    params: campIdParam,
    body: { content: { 'application/json': { schema: AddRosterInput } } },
  },
  responses: {
    201: {
      description: 'Added roster row (pending until the phone signs in)',
      content: { 'application/json': { schema: RosterParticipantSchema } },
    },
    403: { description: 'Not a manager of this camp' },
    409: { description: 'This phone is already in 2 camps' },
  },
})
registry.registerPath({
  method: 'patch',
  path: '/api/organizer/camps/{id}/roster/{mid}',
  tags: ['Roster'],
  summary: 'Reassign group / set role',
  request: {
    params: rosterIdParams,
    body: { content: { 'application/json': { schema: UpdateRosterInput } } },
  },
  responses: {
    200: {
      description: 'Updated row',
      content: { 'application/json': { schema: RosterParticipantSchema } },
    },
    404: { description: 'Membership not found' },
  },
})
registry.registerPath({
  method: 'patch',
  path: '/api/organizer/camps/{id}/roster/{mid}/checkin',
  tags: ['Roster'],
  summary: 'Toggle check-in in/out',
  request: {
    params: rosterIdParams,
    body: { content: { 'application/json': { schema: CheckinInput } } },
  },
  responses: {
    200: {
      description: 'Updated row',
      content: { 'application/json': { schema: RosterParticipantSchema } },
    },
    404: { description: 'Membership not found' },
  },
})
registry.registerPath({
  method: 'delete',
  path: '/api/organizer/camps/{id}/roster/{mid}',
  tags: ['Roster'],
  summary: 'Remove a participant from the camp',
  request: { params: rosterIdParams },
  responses: {
    204: { description: 'Removed' },
    404: { description: 'Membership not found' },
  },
})

// ── Groups ──────────────────────────────────────────────────────────────
const CampGroupDetailSchema = registry.register(
  'CampGroupDetail',
  z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    memberCount: z.number(),
    leaderName: z.string().nullable(),
    members: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        initials: z.string(),
        avatarColor: z.string(),
        photo: z.string().nullable(),
        isLeader: z.boolean(),
      }),
    ),
  }),
)
const CreateGroupInput = registry.register('CreateGroupInput', createGroupSchema)
const UpdateGroupInput = registry.register('UpdateGroupInput', updateGroupSchema)

registry.registerPath({
  method: 'get',
  path: '/api/organizer/camps/{id}/groups',
  tags: ['Groups'],
  summary: 'Groups of a camp (members + leader)',
  request: { params: campIdParam },
  responses: {
    200: {
      description: 'Groups',
      content: { 'application/json': { schema: z.array(CampGroupDetailSchema) } },
    },
    403: { description: 'Not a manager of this camp' },
    404: { description: 'Camp not found' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/organizer/camps/{id}/groups',
  tags: ['Groups'],
  summary: 'Create a group',
  request: {
    params: campIdParam,
    body: { content: { 'application/json': { schema: CreateGroupInput } } },
  },
  responses: {
    201: {
      description: 'Created group',
      content: { 'application/json': { schema: CampGroupDetailSchema } },
    },
    403: { description: 'Not a manager of this camp' },
  },
})
registry.registerPath({
  method: 'patch',
  path: '/api/organizer/camps/{id}/groups/{gid}',
  tags: ['Groups'],
  summary: 'Rename / recolor / set leader',
  request: {
    params: groupIdParams,
    body: { content: { 'application/json': { schema: UpdateGroupInput } } },
  },
  responses: {
    200: {
      description: 'Updated group',
      content: { 'application/json': { schema: CampGroupDetailSchema } },
    },
    404: { description: 'Group not found' },
  },
})
registry.registerPath({
  method: 'delete',
  path: '/api/organizer/camps/{id}/groups/{gid}',
  tags: ['Groups'],
  summary: 'Delete a group (unassigns its members)',
  request: { params: groupIdParams },
  responses: {
    204: { description: 'Deleted' },
    404: { description: 'Group not found' },
  },
})

// ── Schedule ────────────────────────────────────────────────────────────
const ActivityScopeSchema = z.union([
  z.object({ kind: z.literal('camp') }),
  z.object({ kind: z.literal('group'), groupId: z.string(), groupName: z.string() }),
])
const ActivitySchema = registry.register(
  'Activity',
  z.object({
    id: z.string(),
    campId: z.string(),
    title: z.string(),
    location: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    scope: ActivityScopeSchema,
    description: z.string().nullable(),
  }),
)
const CreateActivityInput = registry.register('CreateActivityInput', createActivitySchema)
const UpdateActivityInput = registry.register('UpdateActivityInput', updateActivitySchema)

registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}/schedule',
  tags: ['Schedule'],
  summary: 'All activities of a camp (member read)',
  request: { params: campIdParam },
  responses: {
    200: {
      description: 'Activities, earliest first',
      content: { 'application/json': { schema: z.array(ActivitySchema) } },
    },
    403: { description: 'Not a member of this camp' },
    404: { description: 'Camp not found' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/camps/{id}/schedule',
  tags: ['Schedule'],
  summary: 'Create an activity (manager)',
  request: {
    params: campIdParam,
    body: { content: { 'application/json': { schema: CreateActivityInput } } },
  },
  responses: {
    201: {
      description: 'Created activity',
      content: { 'application/json': { schema: ActivitySchema } },
    },
    403: { description: 'Not a manager of this camp' },
  },
})
registry.registerPath({
  method: 'patch',
  path: '/api/camps/{id}/schedule/{aid}',
  tags: ['Schedule'],
  summary: 'Edit an activity (manager)',
  request: {
    params: activityIdParams,
    body: { content: { 'application/json': { schema: UpdateActivityInput } } },
  },
  responses: {
    200: {
      description: 'Updated activity',
      content: { 'application/json': { schema: ActivitySchema } },
    },
    404: { description: 'Activity not found' },
  },
})
registry.registerPath({
  method: 'delete',
  path: '/api/camps/{id}/schedule/{aid}',
  tags: ['Schedule'],
  summary: 'Delete an activity (manager)',
  request: { params: activityIdParams },
  responses: {
    204: { description: 'Deleted' },
    404: { description: 'Activity not found' },
  },
})

// ── Announcements ───────────────────────────────────────────────────────
const AnnouncementSchema = registry.register(
  'Announcement',
  z.object({
    id: z.string(),
    campId: z.string(),
    title: z.string().optional(),
    body: z.string(),
    scope: ActivityScopeSchema,
    author: z.object({
      id: z.string(),
      name: z.string(),
      role: z.enum(['organizer', 'organization']),
      avatarColor: z.string(),
      photo: z.string().nullable(),
    }),
    pinned: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
  }),
)
const CreateAnnouncementInput = registry.register(
  'CreateAnnouncementInput',
  createAnnouncementSchema,
)
const UpdateAnnouncementInput = registry.register(
  'UpdateAnnouncementInput',
  updateAnnouncementSchema,
)
const PinInput = registry.register('PinInput', pinSchema)

registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}/announcements',
  tags: ['Announcements'],
  summary: 'Announcements of a camp (pinned first)',
  request: { params: campIdParam },
  responses: {
    200: {
      description: 'Announcements',
      content: { 'application/json': { schema: z.array(AnnouncementSchema) } },
    },
    403: { description: 'Not a member of this camp' },
    404: { description: 'Camp not found' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}/announcements/{aid}',
  tags: ['Announcements'],
  summary: 'One announcement',
  request: { params: announcementIdParams },
  responses: {
    200: {
      description: 'Announcement',
      content: { 'application/json': { schema: AnnouncementSchema } },
    },
    404: { description: 'Announcement not found' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/camps/{id}/announcements',
  tags: ['Announcements'],
  summary: 'Post an announcement (manager)',
  request: {
    params: campIdParam,
    body: { content: { 'application/json': { schema: CreateAnnouncementInput } } },
  },
  responses: {
    201: {
      description: 'Created announcement',
      content: { 'application/json': { schema: AnnouncementSchema } },
    },
    403: { description: 'Not a manager of this camp' },
  },
})
registry.registerPath({
  method: 'patch',
  path: '/api/camps/{id}/announcements/{aid}',
  tags: ['Announcements'],
  summary: 'Edit an announcement (manager)',
  request: {
    params: announcementIdParams,
    body: { content: { 'application/json': { schema: UpdateAnnouncementInput } } },
  },
  responses: {
    200: {
      description: 'Updated announcement',
      content: { 'application/json': { schema: AnnouncementSchema } },
    },
    404: { description: 'Announcement not found' },
  },
})
registry.registerPath({
  method: 'patch',
  path: '/api/camps/{id}/announcements/{aid}/pin',
  tags: ['Announcements'],
  summary: 'Pin / unpin an announcement (manager)',
  request: {
    params: announcementIdParams,
    body: { content: { 'application/json': { schema: PinInput } } },
  },
  responses: {
    200: {
      description: 'Updated announcement',
      content: { 'application/json': { schema: AnnouncementSchema } },
    },
    404: { description: 'Announcement not found' },
  },
})
registry.registerPath({
  method: 'delete',
  path: '/api/camps/{id}/announcements/{aid}',
  tags: ['Announcements'],
  summary: 'Delete an announcement (manager)',
  request: { params: announcementIdParams },
  responses: {
    204: { description: 'Deleted' },
    404: { description: 'Announcement not found' },
  },
})

// ── Leaderboard ─────────────────────────────────────────────────────────
const LeaderboardSchema = registry.register(
  'Leaderboard',
  z.object({
    periodLabel: z.string(),
    currentGroupId: z.string().nullable(),
    groups: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        color: z.string(),
        photo: z.string().optional(),
        score: z.number(),
        previousScore: z.number(),
        breakdown: z.object({
          activities: z.number(),
          attendance: z.number(),
          challenges: z.number(),
        }),
      }),
    ),
  }),
)
const AdjustPointsInput = registry.register('AdjustPointsInput', adjustPointsSchema)

registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}/leaderboard',
  tags: ['Leaderboard'],
  summary: 'Group standings + categories (member read)',
  request: { params: campIdParam },
  responses: {
    200: {
      description: 'Leaderboard',
      content: { 'application/json': { schema: LeaderboardSchema } },
    },
    403: { description: 'Not a member of this camp' },
    404: { description: 'Camp not found' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/camps/{id}/leaderboard/{gid}/points',
  tags: ['Leaderboard'],
  summary: 'Adjust a group’s points in a category (manager)',
  request: {
    params: leaderboardParams,
    body: { content: { 'application/json': { schema: AdjustPointsInput } } },
  },
  responses: {
    204: { description: 'Adjusted' },
    403: { description: 'Not a manager of this camp' },
    404: { description: 'Group has no leaderboard row' },
  },
})

// ── Team ────────────────────────────────────────────────────────────────
const SUB_ROLE = z.enum([
  'projectManager',
  'coordinator',
  'admin',
  'media',
  'brandFace',
  'eventManager',
  'photographer',
])
const TeamSchema = registry.register(
  'Team',
  z.object({
    organizationName: z.string(),
    members: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        initials: z.string(),
        avatarColor: z.string(),
        photo: z.string().nullable(),
        role: SUB_ROLE,
        isMe: z.boolean().optional(),
      }),
    ),
    pending: z.array(
      z.object({
        id: z.string(),
        phone: z.string(),
        role: SUB_ROLE,
        sentAt: z.string(),
      }),
    ),
  }),
)
const InviteTeamInput = registry.register('InviteTeamInput', inviteTeamSchema)
const PendingInviteSchema = registry.register(
  'PendingInvite',
  z.object({ id: z.string(), phone: z.string(), role: SUB_ROLE, sentAt: z.string() }),
)

registry.registerPath({
  method: 'get',
  path: '/api/organizer/team',
  tags: ['Team'],
  summary: 'The organizer team + pending invites (organizer only)',
  responses: {
    200: {
      description: 'Team',
      content: { 'application/json': { schema: TeamSchema } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/organizer/team/invites',
  tags: ['Team'],
  summary: 'Invite a teammate by phone + sub-role (never a peer organizer)',
  request: { body: { content: { 'application/json': { schema: InviteTeamInput } } } },
  responses: {
    201: {
      description: 'Pending invite',
      content: { 'application/json': { schema: PendingInviteSchema } },
    },
    403: { description: 'Insufficient permissions' },
    409: { description: 'Create a camp first / phone already on the team' },
  },
})
registry.registerPath({
  method: 'delete',
  path: '/api/organizer/team/invites/{id}',
  tags: ['Team'],
  summary: 'Cancel a pending invite (organizer only)',
  request: { params: teamInviteIdParam },
  responses: {
    204: { description: 'Cancelled' },
    404: { description: 'Invite not found' },
  },
})

// Generate the final OpenAPI 3.0 document from everything registered above.
export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions)
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Camply API',
      version: '1.0.0',
      description: 'API documentation for the Camply backend.',
    },
    servers: [{ url: 'http://localhost:4000' }],
  })
}
