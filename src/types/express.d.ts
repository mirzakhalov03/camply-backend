import type { HydratedDocument } from 'mongoose'
import type { User } from '../models/user.model'
import type { Session } from '../models/session.model'

// Declaration merge: after requireAuth runs, every handler can read a typed
// req.auth. Optional because unauthenticated routes never set it.
declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: HydratedDocument<User>
        session: HydratedDocument<Session>
      }
    }
  }
}

export {}
