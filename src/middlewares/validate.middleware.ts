import type { RequestHandler } from 'express'
import type { ZodType } from 'zod'

type Schemas = {
  body?: ZodType
  params?: ZodType
  query?: ZodType
}

// Validates request parts against Zod schemas and replaces them with the
// parsed (typed, coerced) values. Throws a ZodError on failure, which the
// error middleware turns into a 400.
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    if (schemas.body) req.body = schemas.body.parse(req.body)
    if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params
    if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query))
    next()
  }
