import type { RequestHandler } from 'express'
import { groupService, toMyGroup } from '../services/group.services'
import { GroupModel } from '../models/group.model'
import { HttpError } from '../middlewares/error.middleware'

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

/*
  Set (or clear, with null) the photo of the caller's OWN group — the participant
  chat header's uploader. Any member of the group may do this: the photo is shared
  group identity, the same way a group chat's picture works everywhere else.

  Same structural guarantee as getMyGroup — the group comes from the caller's
  membership, so there is no id to point at someone else's group. 409, not 403, when
  unassigned: the caller isn't forbidden, there's simply nothing to set a photo on.
*/
export const setMyGroupPhoto: RequestHandler = async (req, res) => {
  const groupId = req.membership?.groupId
  if (!groupId) throw new HttpError(409, 'You are not in a group yet')

  const group = await groupService.setMyGroupPhoto(
    groupId,
    req.body.photo,
    String(req.auth!.user._id),
  )
  res.json({ group })
}

export const listGroups: RequestHandler = async (req, res) => {
  res.json(await groupService.list(req.camp!._id))
}
export const createGroup: RequestHandler = async (req, res) => {
  res.status(201).json(await groupService.create(req.camp!._id, req.body))
}
export const updateGroup: RequestHandler = async (req, res) => {
  res.json(await groupService.update(String(req.params.gid), req.body, String(req.auth!.user._id)))
}
export const removeGroup: RequestHandler = async (req, res) => {
  await groupService.remove(String(req.params.gid))
  res.status(204).end()
}
