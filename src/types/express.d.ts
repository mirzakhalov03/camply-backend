import type { HydratedDocument } from 'mongoose'
import type { User } from '../models/user.model'
import type { Session } from '../models/session.model'
import type { Camp } from '../models/camp.model'
import type { Membership } from '../models/membership.model'

// Declaration merge: after requireAuth runs, every handler can read a typed
// req.auth. Optional because unauthenticated routes never set it.
declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: HydratedDocument<User>
        session: HydratedDocument<Session>
      }
      // Set by requireCampMember: the resolved camp and the caller's membership
      // (null for an organization super-admin, who has no membership row).
      camp?: HydratedDocument<Camp>
      membership?: HydratedDocument<Membership> | null
    }
  }
}

export {}
