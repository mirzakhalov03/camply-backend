import type { RequestHandler } from 'express'
import { teamService } from '../services/team.services'

export const getTeam: RequestHandler = async (req, res) => {
  res.json(await teamService.list(req.auth!.user))
}
export const inviteTeammate: RequestHandler = async (req, res) => {
  res
    .status(201)
    .json(await teamService.invite(req.auth!.user, req.body.phone, req.body.role, req.body.groupId))
}
export const setTeamMemberGroup: RequestHandler = async (req, res) => {
  res.json(await teamService.setCoordinatorGroup(String(req.params.membershipId), req.body.groupId))
}
export const cancelTeamInvite: RequestHandler = async (req, res) => {
  await teamService.cancelInvite(String(req.params.id))
  res.status(204).end()
}
