import type { RequestHandler } from 'express'
import { announcementService } from '../services/announcement.services'

export const listAnnouncements: RequestHandler = async (req, res) => {
  res.json(await announcementService.list(req.camp!._id))
}
export const getAnnouncement: RequestHandler = async (req, res) => {
  res.json(await announcementService.getById(String(req.params.aid)))
}
export const createAnnouncement: RequestHandler = async (req, res) => {
  res
    .status(201)
    .json(await announcementService.create(req.camp!._id, req.auth!.user._id, req.body))
}
export const updateAnnouncement: RequestHandler = async (req, res) => {
  res.json(await announcementService.update(String(req.params.aid), req.body))
}
export const pinAnnouncement: RequestHandler = async (req, res) => {
  res.json(await announcementService.setPinned(String(req.params.aid), req.body.pinned))
}
export const deleteAnnouncement: RequestHandler = async (req, res) => {
  await announcementService.remove(String(req.params.aid))
  res.status(204).end()
}
