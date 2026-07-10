import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { z } from '../config/zod'
import { registerSchema, loginSchema, createOrganizerSchema } from '../validators/auth.validators'

const registry = new OpenAPIRegistry()

// ── Reusable component schemas ────────────────────────────────────────────
const PublicUserSchema = registry.register(
  'PublicUser',
  z.object({
    id: z.string().openapi({ example: '665f1b2c9d1e4a0012a3b4c5' }),
    phone: z.string().openapi({ example: '+998901234567' }),
    name: z.string().openapi({ example: 'Ali' }),
    surname: z.string().openapi({ example: 'Valiyev' }),
    role: z.enum(['participant', 'organizer', 'organization']).openapi({ example: 'participant' }),
  }),
)

const SessionResponse = z.object({ user: PublicUserSchema })

const RegisterInput = registry.register('RegisterInput', registerSchema)
const LoginInput = registry.register('LoginInput', loginSchema)
const CreateOrganizerInput = registry.register('CreateOrganizerInput', createOrganizerSchema)

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
  path: '/api/auth/register',
  tags: ['Auth'],
  summary: 'Register a participant (role is always participant)',
  request: { body: { content: { 'application/json': { schema: RegisterInput } } } },
  responses: {
    201: {
      description: 'Session started; sets the camply_sid cookie',
      content: { 'application/json': { schema: SessionResponse } },
    },
    409: { description: 'Phone already registered' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  tags: ['Auth'],
  summary: 'Log in (participant: phone only; org/organizer: phone + password)',
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
  method: 'post',
  path: '/api/organizers',
  tags: ['Auth'],
  summary: 'Create an organizer (organization only)',
  request: { body: { content: { 'application/json': { schema: CreateOrganizerInput } } } },
  responses: {
    201: {
      description: 'Organizer created',
      content: { 'application/json': { schema: SessionResponse } },
    },
    401: { description: 'Not authenticated' },
    403: { description: 'Insufficient permissions' },
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
