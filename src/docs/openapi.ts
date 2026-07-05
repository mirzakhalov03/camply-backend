import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { z } from '../config/zod'
import { createUserSchema, userIdParamSchema } from '../validators/user.validators'

// Reusing the validator schemas here means the docs can never drift from
// what the API actually accepts — single source of truth. `z` comes from
// config/zod, which has already been extended with `.openapi()`.
const registry = new OpenAPIRegistry()

// ── Reusable component schemas ────────────────────────────────────────────
const UserSchema = registry.register(
  'User',
  z.object({
    _id: z.string().openapi({ example: '665f1b2c9d1e4a0012a3b4c5' }),
    name: z.string().openapi({ example: 'Ada Lovelace' }),
    email: z.email().openapi({ example: 'ada@example.com' }),
    createdAt: z.string().openapi({ example: '2026-07-05T12:00:00.000Z' }),
    updatedAt: z.string().openapi({ example: '2026-07-05T12:00:00.000Z' }),
  }),
)

const CreateUserSchema = registry.register('CreateUserInput', createUserSchema)

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
        'application/json': {
          schema: z.object({ status: z.string(), uptime: z.number() }),
        },
      },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/users',
  tags: ['Users'],
  summary: 'List users',
  responses: {
    200: {
      description: 'Array of users',
      content: { 'application/json': { schema: z.array(UserSchema) } },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/users/{id}',
  tags: ['Users'],
  summary: 'Get a user by id',
  request: { params: userIdParamSchema },
  responses: {
    200: {
      description: 'The user',
      content: { 'application/json': { schema: UserSchema } },
    },
    404: { description: 'User not found' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/users',
  tags: ['Users'],
  summary: 'Create a user',
  request: {
    body: {
      content: { 'application/json': { schema: CreateUserSchema } },
    },
  },
  responses: {
    201: {
      description: 'Created user',
      content: { 'application/json': { schema: UserSchema } },
    },
    400: { description: 'Validation failed' },
    409: { description: 'Email already in use' },
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
