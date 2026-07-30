import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { z } from '../config/zod'
import {
  loginSchema,
  completeProfileSchema,
  setLanguageSchema,
  setPhotoSchema,
} from '../validators/auth.validators'
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
} from '../validators/roster.validators'
import {
  groupIdParams,
  createGroupSchema,
  updateGroupSchema,
  myGroupPhotoSchema,
} from '../validators/group.validators'
import {
  placeIdParams,
  createPlaceSchema,
  updatePlaceSchema,
  boundarySchema,
  PLACE_ICONS,
} from '../validators/place.validators'
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
import { presignSchema } from '../validators/upload.validators'
import { subscribeSchema, unsubscribeSchema } from '../validators/push.validators'
import {
  inviteTeamSchema,
  teamInviteIdParam,
  membershipIdParam,
  setCoordinatorGroupSchema,
} from '../validators/team.validators'

const registry = new OpenAPIRegistry()

// ── Reusable component schemas ────────────────────────────────────────────
const PublicUserSchema = registry.register(
  'PublicUser',
  z.object({
    id: z.string().openapi({ example: '665f1b2c9d1e4a0012a3b4c5' }),
    phone: z.string().nullable().openapi({ example: '+998901234567' }),
    email: z.string().nullable().openapi({ example: 'ali@camply.uz' }),
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

const PresignInputSchema = registry.register('PresignInput', presignSchema)

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
    dayCurrent: z.number(),
    dayTotal: z.number(),
    coverImage: z.string().nullable(),
  }),
)
// The organization's org-wide projection — carries the owning manager's name for
// cross-manager attribution, and drops the per-camp dashboard counts it doesn't use.
const AdminCampSchema = registry.register(
  'AdminCamp',
  z.object({
    id: z.string(),
    name: z.string().openapi({ example: 'Summer Leadership Camp' }),
    organizerName: z.string().openapi({ example: 'Aziz Karimov' }),
    location: z.string().openapi({ example: 'Chimgan' }),
    dateRange: z.string().openapi({ example: 'Jul 6 – Jul 19' }),
    status: z.enum(['active', 'upcoming', 'draft', 'archived']),
    participantCount: z.number(),
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
  method: 'post',
  path: '/api/uploads/presign',
  tags: ['Uploads'],
  summary: 'Mint a presigned S3 PUT (images ≤5 MB; chat documents ≤15 MB)',
  request: { body: { content: { 'application/json': { schema: PresignInputSchema } } } },
  responses: {
    200: {
      description: 'Presigned upload target. PUT the file to uploadUrl, then attach `key`.',
      content: {
        'application/json': {
          schema: z.object({
            uploadUrl: z.string(),
            key: z.string().openapi({ example: 'avatar/665f…/9f3c…​.jpg' }),
            publicUrl: z.string(),
            expiresIn: z.number().openapi({ example: 60 }),
          }),
        },
      },
    },
    400: {
      description: 'Over the size limit, unsupported type, or a document on a non-chat purpose',
    },
    503: { description: 'Storage is not configured' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/uploads/{key}',
  tags: ['Uploads'],
  summary: 'Redirect to a short-lived signed URL for an uploaded image',
  description:
    'The bucket is private, so this is how images are read back — point an <img src> ' +
    'straight at it. Any authenticated user may fetch a key they know; keys are ' +
    'random UUIDs handed out only by endpoints that already scope their responses.',
  request: {
    params: z.object({
      key: z.string().openapi({
        example: 'avatar/665f…/9f3c….jpg',
        description: '{purpose}/{userId}/{uuid}.{ext}',
      }),
    }),
  },
  responses: {
    302: { description: 'Location: a presigned S3 GET, valid 300s' },
    400: { description: 'Malformed key — not one this API minted' },
    401: { description: 'Not signed in' },
    503: { description: 'Storage is not configured' },
  },
})
registry.registerPath({
  method: 'get',
  path: '/api/camps',
  tags: ['Camps'],
  summary: "Every camp in the caller's organization (organization only)",
  responses: {
    200: {
      description: 'Org-wide camp list, active first',
      content: { 'application/json': { schema: z.object({ camps: z.array(AdminCampSchema) }) } },
    },
    403: { description: 'Not an organization account' },
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

registry.registerPath({
  method: 'patch',
  path: '/api/camps/{id}/my-group/photo',
  tags: ['Camps'],
  summary: "Set the photo of the caller's own group",
  description:
    "MEMBER-level write — any member of the group may set its identity photo, the way a group chat's picture works. The target group is the caller's own `membership.groupId`, never a request parameter, so this cannot reach another group. `photo` is an upload key from `POST /uploads/presign` (ownership-checked), or `null` to clear it back to the emoji tile.",
  request: {
    params: campIdParam,
    body: { content: { 'application/json': { schema: myGroupPhotoSchema } } },
  },
  responses: {
    200: {
      description: 'The updated group',
      content: { 'application/json': { schema: z.object({ group: MyGroupSchema }) } },
    },
    400: { description: 'Invalid body' },
    403: { description: 'Not a member of this camp, or the key belongs to another user' },
    404: { description: 'Camp not found' },
    409: { description: 'The caller is not in a group yet' },
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
    phone: z.string(),
  }),
)
const AddRosterInput = registry.register('AddRosterInput', addRosterSchema)
const UpdateRosterInput = registry.register('UpdateRosterInput', updateRosterSchema)

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

// ── Camp map: places + boundary ─────────────────────────────────────────
const CoordsSchema = z.object({ lat: z.number(), lon: z.number() })
const BoundaryObject = registry.register(
  'CampBoundary',
  z.object({ center: CoordsSchema, radiusM: z.number() }),
)
const PlaceSchema = registry.register(
  'Place',
  z.object({
    id: z.string(),
    kind: z.enum(['zone', 'landmark']),
    name: z.string(),
    icon: z.enum(PLACE_ICONS),
    shape: z.literal('circle'),
    center: CoordsSchema,
    // Metres. Set for a zone, always null for a landmark.
    radiusM: z.number().nullable(),
    order: z.number(),
  }),
)
const MapPlacesSchema = registry.register(
  'CampMapPlaces',
  z.object({ boundary: BoundaryObject.nullable(), places: z.array(PlaceSchema) }),
)
const CreatePlaceInput = registry.register('CreatePlaceInput', createPlaceSchema)
const UpdatePlaceInput = registry.register('UpdatePlaceInput', updatePlaceSchema)
const SetBoundaryInput = registry.register('SetBoundaryInput', boundarySchema)

registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}/map/places',
  tags: ['Camp map'],
  summary: 'Camp boundary + zones + landmarks (member-level read)',
  request: { params: campIdParam },
  responses: {
    200: {
      description: 'Static map layer',
      content: { 'application/json': { schema: MapPlacesSchema } },
    },
    403: { description: 'Not a member of this camp' },
    404: { description: 'Camp not found' },
  },
})
registry.registerPath({
  method: 'post',
  path: '/api/organizer/camps/{id}/map/places',
  tags: ['Camp map'],
  summary: 'Create a zone or landmark',
  request: {
    params: campIdParam,
    body: { content: { 'application/json': { schema: CreatePlaceInput } } },
  },
  responses: {
    201: { description: 'Created place', content: { 'application/json': { schema: PlaceSchema } } },
    400: { description: 'A zone needs a radius; a landmark cannot have one' },
    403: { description: 'Not a manager of this camp' },
  },
})
registry.registerPath({
  method: 'patch',
  path: '/api/organizer/camps/{id}/map/places/{pid}',
  tags: ['Camp map'],
  summary: 'Rename / move / resize a place (kind is immutable)',
  request: {
    params: placeIdParams,
    body: { content: { 'application/json': { schema: UpdatePlaceInput } } },
  },
  responses: {
    200: { description: 'Updated place', content: { 'application/json': { schema: PlaceSchema } } },
    400: { description: 'Radius does not match the stored kind' },
    404: { description: 'Place not found in this camp' },
  },
})
registry.registerPath({
  method: 'delete',
  path: '/api/organizer/camps/{id}/map/places/{pid}',
  tags: ['Camp map'],
  summary: 'Delete a place',
  request: { params: placeIdParams },
  responses: {
    204: { description: 'Deleted' },
    404: { description: 'Place not found in this camp' },
  },
})
registry.registerPath({
  method: 'patch',
  path: '/api/organizer/camps/{id}/map/boundary',
  tags: ['Camp map'],
  summary: 'Set or clear the camp boundary circle',
  request: {
    params: campIdParam,
    body: { content: { 'application/json': { schema: SetBoundaryInput } } },
  },
  responses: {
    200: {
      description: 'Updated boundary',
      content: {
        'application/json': { schema: z.object({ boundary: BoundaryObject.nullable() }) },
      },
    },
    403: { description: 'Not a manager of this camp' },
    404: { description: 'Camp not found' },
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

registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}/chat/group/messages',
  tags: ['Chat'],
  summary: "The caller's group chat — latest 50 messages + room members",
  request: { params: campIdParam },
  responses: {
    200: { description: 'Group history (empty if unassigned)' },
    401: { description: 'Not authenticated' },
    403: { description: 'Not a member of this camp' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}/chat/organizers/messages',
  tags: ['Chat'],
  summary: 'The organizers channel — latest 50 messages + organizer-tier members',
  request: { params: campIdParam },
  responses: {
    200: { description: 'Organizers history' },
    401: { description: 'Not authenticated' },
    403: { description: 'Organizer-tier only' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/camps/{id}/my-role',
  tags: ['Chat'],
  summary: "The caller's own role + group in this camp (coordinator gating)",
  request: { params: campIdParam },
  responses: {
    200: { description: '{ role, groupId }' },
    401: { description: 'Not authenticated' },
    403: { description: 'Not a member of this camp' },
  },
})

registry.registerPath({
  method: 'patch',
  path: '/api/organizer/team/{membershipId}/group',
  tags: ['Team'],
  summary: "Reassign or clear a coordinator's chat group (manager only)",
  request: {
    params: membershipIdParam,
    body: { content: { 'application/json': { schema: setCoordinatorGroupSchema } } },
  },
  responses: {
    200: { description: 'Updated' },
    400: { description: 'Target is not a coordinator / group not in camp' },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    404: { description: 'Membership not found' },
  },
})

registry.registerPath({
  method: 'patch',
  path: '/api/auth/me/language',
  tags: ['Auth'],
  summary: "Set the caller's UI language (synced for push localization)",
  request: { body: { content: { 'application/json': { schema: setLanguageSchema } } } },
  responses: {
    200: { description: 'Updated user' },
    401: { description: 'Not authenticated' },
  },
})

registry.registerPath({
  method: 'patch',
  path: '/api/auth/me/photo',
  tags: ['Auth'],
  summary: "Set or clear the caller's avatar (no profile prerequisites)",
  description:
    'Takes an upload KEY from POST /uploads/presign, or null to clear. Separate from ' +
    'PATCH /auth/me because that one requires name+surname+city+age, which an ' +
    'organizer invited by email may not have.',
  request: { body: { content: { 'application/json': { schema: setPhotoSchema } } } },
  responses: {
    200: { description: 'Updated user' },
    401: { description: 'Not authenticated' },
    403: { description: 'That upload key belongs to someone else' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/push/subscribe',
  tags: ['Push'],
  summary: 'Register a Web Push subscription (idempotent upsert on endpoint)',
  request: { body: { content: { 'application/json': { schema: subscribeSchema } } } },
  responses: {
    201: { description: 'Subscription stored' },
    401: { description: 'Not authenticated' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/api/push/subscribe',
  tags: ['Push'],
  summary: 'Remove a Web Push subscription by endpoint',
  request: { body: { content: { 'application/json': { schema: unsubscribeSchema } } } },
  responses: {
    204: { description: 'Subscription removed' },
    401: { description: 'Not authenticated' },
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
