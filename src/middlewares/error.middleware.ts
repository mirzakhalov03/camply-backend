import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { env } from '../config/env'

// Small helper to throw HTTP errors with a status code from anywhere.
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

// 404 for anything that fell through the routers.
export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`))
}

// Central error handler — Express 5 forwards rejected async handlers here too.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ message: 'Validation failed', errors: err.issues })
    return
  }

  const status = err instanceof HttpError ? err.status : 500
  const message = status === 500 ? 'Internal server error' : err.message

  if (status === 500) console.error(err)

  res.status(status).json({
    message,
    ...(env.NODE_ENV === 'development' && status === 500 ? { stack: err.stack } : {}),
  })
}
