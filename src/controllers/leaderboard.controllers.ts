import type { RequestHandler } from 'express'
import { leaderboardService } from '../services/leaderboard.services'

export const getLeaderboard: RequestHandler = async (req, res) => {
  res.json(await leaderboardService.get(req.camp!._id, req.auth!.user._id))
}
export const adjustPoints: RequestHandler = async (req, res) => {
  await leaderboardService.adjust(
    req.camp!._id,
    String(req.params.gid),
    req.body.delta,
    req.body.category,
    req.auth!.user._id,
  )
  res.status(204).end()
}
