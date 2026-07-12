import type { RequestHandler } from 'express'
import { scheduleService } from '../services/schedule.services'

export const listSchedule: RequestHandler = async (req, res) => {
  res.json(await scheduleService.list(req.camp!._id))
}
export const createActivity: RequestHandler = async (req, res) => {
  res.status(201).json(await scheduleService.create(req.camp!._id, req.body))
}
export const updateActivity: RequestHandler = async (req, res) => {
  res.json(await scheduleService.update(String(req.params.aid), req.body))
}
export const deleteActivity: RequestHandler = async (req, res) => {
  await scheduleService.remove(String(req.params.aid))
  res.status(204).end()
}
