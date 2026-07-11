import type { RequestHandler } from 'express'
import { organizerService } from '../services/organizer.services'

export const listOrganizers: RequestHandler = async (_req, res) => {
  const organizers = await organizerService.list()
  res.json({ organizers })
}

export const createOrganizer: RequestHandler = async (req, res) => {
  const organizer = await organizerService.create(req.body)
  res.status(201).json({ organizer })
}

export const updateOrganizer: RequestHandler = async (req, res) => {
  // organizerIdParam already validated :id as a 24-hex string; coerce for the type.
  const organizer = await organizerService.setActive(String(req.params.id), req.body.active)
  res.json({ organizer })
}
