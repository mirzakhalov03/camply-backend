import type { RequestHandler } from 'express'
import { rosterService } from '../services/roster.services'

export const listRoster: RequestHandler = async (req, res) => {
  res.json(await rosterService.list(req.camp!._id))
}
export const addRoster: RequestHandler = async (req, res) => {
  res.status(201).json(await rosterService.add(req.camp!._id, req.body.phone, req.body.groupId))
}
export const updateRoster: RequestHandler = async (req, res) => {
  res.json(await rosterService.update(String(req.params.mid), req.body))
}
export const setCheckin: RequestHandler = async (req, res) => {
  res.json(await rosterService.setCheckin(String(req.params.mid), req.body.status))
}
export const removeRoster: RequestHandler = async (req, res) => {
  await rosterService.remove(String(req.params.mid))
  res.status(204).end()
}
