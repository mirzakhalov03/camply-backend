import type { RequestHandler } from 'express'
import { campService } from '../services/camp.services'

export const listCamps: RequestHandler = async (req, res) => {
  res.json(await campService.listForOrganizer(req.auth!.user))
}
export const getCampSummary: RequestHandler = async (req, res) => {
  res.json(await campService.summary(req.auth!.user))
}
export const getCamp: RequestHandler = async (req, res) => {
  res.json(await campService.getOne(req.camp!))
}
export const createCamp: RequestHandler = async (req, res) => {
  // createFull handles the plain (no groups/participants) case too; `created` is
  // false only on a clientRequestId dedupe hit, which returns 200 not 201.
  const { camp, created } = await campService.createFull(req.body, req.auth!.user)
  res.status(created ? 201 : 200).json(camp)
}
export const updateCamp: RequestHandler = async (req, res) => {
  res.json(await campService.update(req.camp!, req.body))
}
export const publishCamp: RequestHandler = async (req, res) => {
  res.json(await campService.publish(req.camp!))
}
export const archiveCamp: RequestHandler = async (req, res) => {
  res.json(await campService.archive(req.camp!))
}
export const deleteCamp: RequestHandler = async (req, res) => {
  await campService.remove(req.camp!)
  res.status(204).end()
}
