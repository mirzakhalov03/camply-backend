import type { RequestHandler } from 'express'
import { userService } from '../services/user.services'

// Thin HTTP layer. No try/catch needed — Express 5 forwards any thrown
// error (or rejected promise) to the error middleware.
export const listUsers: RequestHandler = async (_req, res) => {
  const users = await userService.list()
  res.json(users)
}

export const getUser: RequestHandler = async (req, res) => {
  const user = await userService.getById(String(req.params.id))
  res.json(user)
}

export const createUser: RequestHandler = async (req, res) => {
  const user = await userService.create(req.body)
  res.status(201).json(user)
}
