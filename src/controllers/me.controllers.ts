import type { RequestHandler } from 'express'
import { campService } from '../services/camp.services'
import { HttpError } from '../middlewares/error.middleware'

/*
  The caller's own camps. Self-scoped by definition — requireAuth is the only guard,
  because the answer derives from who you are, not from a role rank.

  An empty list is a valid 200, not a 404: a participant rostered onto an
  unpublished camp, or not yet added to one, is a normal state the client renders
  as its no-camp screen.
*/
export const listMyCamps: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated')
  res.json(await campService.listForParticipant(req.auth.user))
}
