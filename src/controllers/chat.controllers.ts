import type { RequestHandler } from 'express'
import type { Types } from 'mongoose'
import { chatService } from '../services/chat.services'

// The caller's OWN group's chat. groupId comes from req.membership — never the URL,
// same structural-privacy pattern as GET /camps/:id/my-group. Unassigned is a valid
// 200 state (empty), not a 403.
export const getGroupMessages: RequestHandler = async (req, res) => {
  const campId = req.camp!._id
  const groupId = req.membership?.groupId
  if (!groupId) {
    res.json({ groupId: null, members: [], messages: [] })
    return
  }
  res.json(await chatService.listGroupHistory(campId, groupId as Types.ObjectId))
}

// The organizers channel — organizer-tier only (requireCampManager gates the route).
export const getOrganizerMessages: RequestHandler = async (req, res) => {
  res.json(await chatService.listOrganizersHistory(req.camp!._id))
}
