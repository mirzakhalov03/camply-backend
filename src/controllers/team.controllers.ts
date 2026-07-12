import type { RequestHandler } from 'express'
import { teamService } from '../services/team.services'

export const getTeam: RequestHandler = async (req, res) => {
  res.json(await teamService.list(req.auth!.user))
}
export const inviteTeammate: RequestHandler = async (req, res) => {
  res.status(201).json(await teamService.invite(req.auth!.user, req.body.phone, req.body.role))
}
export const cancelTeamInvite: RequestHandler = async (req, res) => {
  await teamService.cancelInvite(String(req.params.id))
  res.status(204).end()
}
