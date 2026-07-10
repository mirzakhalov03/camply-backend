import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import swaggerUi from 'swagger-ui-express'
import { env } from './config/env'
import routes from './routes'
import { buildOpenApiDocument } from './docs/openapi'
import { errorHandler, notFound } from './middlewares/error.middleware'

export function createApp() {
  const app = express()

  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }))
  app.use(express.json())
  app.use(cookieParser())

  // Interactive API docs at /api/docs (spec at /api/docs.json)
  const openApiDocument = buildOpenApiDocument()
  app.get('/api/docs.json', (_req, res) => res.json(openApiDocument))
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))

  // All API routes are mounted under /api
  app.use('/api', routes)

  // Fallthrough + error handling (must be registered last)
  app.use(notFound)
  app.use(errorHandler)

  return app
}
