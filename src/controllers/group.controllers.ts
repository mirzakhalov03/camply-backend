import type { RequestHandler } from 'express'
import { groupService } from '../services/group.services'

export const listGroups: RequestHandler = async (req, res) => {
  res.json(await groupService.list(req.camp!._id))
}
export const createGroup: RequestHandler = async (req, res) => {
  res.status(201).json(await groupService.create(req.camp!._id, req.body))
}
export const updateGroup: RequestHandler = async (req, res) => {
  res.json(await groupService.update(String(req.params.gid), req.body))
}
export const removeGroup: RequestHandler = async (req, res) => {
  await groupService.remove(String(req.params.gid))
  res.status(204).end()
}
