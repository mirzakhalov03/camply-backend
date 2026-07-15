import type { RequestHandler } from 'express'
import { managerService } from '../services/managers.services'

export const listManagers: RequestHandler = async (_req, res) => {
  const managers = await managerService.list()
  res.json({ managers })
}

export const createManager: RequestHandler = async (req, res) => {
  const { user, inviteUrl } = await managerService.create(req.body)
  res.status(201).json({ manager: user, ...(inviteUrl ? { inviteUrl } : {}) })
}

export const resendManagerInvite: RequestHandler = async (req, res) => {
  const { user, inviteUrl } = await managerService.resendInvite(String(req.params.id))
  res.json({ manager: user, ...(inviteUrl ? { inviteUrl } : {}) })
}

export const removeManager: RequestHandler = async (req, res) => {
  await managerService.remove(String(req.params.id))
  res.status(204).end()
}

export const updateManager: RequestHandler = async (req, res) => {
  const manager = await managerService.setActive(String(req.params.id), req.body.active)
  res.json({ manager })
}
