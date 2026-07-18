import type { RequestHandler } from 'express'
import { groupService, toMyGroup } from '../services/group.services'
import { GroupModel } from '../models/group.model'

/*
  The caller's own group in this camp. groupId comes from the caller's OWN
  membership row (resolved by requireCampMember), so no request parameter can
  steer this toward another group's roster — the privacy boundary is structural.

  Unassigned is a valid state, not an error: an organizer may roster a participant
  before sorting groups, so this returns { group: null } with 200.
*/
export const getMyGroup: RequestHandler = async (req, res) => {
  const groupId = req.membership?.groupId
  const group = groupId ? await GroupModel.findById(groupId) : null
  res.json({ group: group ? await toMyGroup(group) : null })
}

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
