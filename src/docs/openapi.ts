import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { z } from '../config/zod'
import { loginSchema, completeProfileSchema } from '../validators/auth.validators'
import {
  createOrganizerSchema,
  updateOrganizerSchema,
  organizerIdParam,
} from '../validators/organizer.validators'
import { acceptInviteSchema } from '../validators/invite.validators'

const registry = new OpenAPIRegistry()

// ── Reusable component schemas ────────────────────────────────────────────
const PublicUserSchema = registry.register(
  'PublicUser',
  z.object({
    id: z.string().openapi({ example: '665f1b2c9d1e4a0012a3b4c5' }),
    phone: z.string().nullable().openapi({ example: '+998901234567' }),
    name: z.string().openapi({ example: 'Ali' }),
    surname: z.string().openapi({ example: 'Valiyev' }),
    role: z.enum(['participant', 'organizer', 'organization']).openapi({ example: 'participant' }),
    cityId: z.string().nullable().openapi({ example: 'Tashkent' }),
    age: z.number().nullable().openapi({ example: 16 }),
    photo: z.string().nullable().openapi({ example: null }),
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
  summary: 'Invite an organizer by email (organization only)',
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
  summary: 'Revoke a pending invite — deletes the stub (organization only)',
  request: { params: organizerIdParam },
  responses: {
    204: { description: 'Invite revoked' },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
    404: { description: 'Organizer not found' },
    409: { description: 'Organizer already active — deactivate instead' },
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
  summary: 'Public: accept an invite by supplying a phone; starts a session',
  request: { body: { content: { 'application/json': { schema: acceptInviteSchema } } } },
  responses: {
    200: { description: 'Accepted; sets the camply_sid cookie' },
    409: { description: 'Phone already registered' },
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
