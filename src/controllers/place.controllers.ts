import type { RequestHandler } from 'express'
import { placeService } from '../services/place.services'

/*
  Camp map geometry — zones, landmarks, and the camp boundary.

  Reads are member-level (a place is camp-wide public and carries no personal data,
  so there is no manager-only projection to justify a second endpoint). Writes are
  manager-tier, enforced by requireCampManager on the router.
*/

export const getMapPlaces: RequestHandler = async (req, res) => {
  res.json(await placeService.listForCamp(req.camp!._id))
}

export const createPlace: RequestHandler = async (req, res) => {
  res.status(201).json(await placeService.create(req.camp!._id, req.body))
}

export const updatePlace: RequestHandler = async (req, res) => {
  res.json(await placeService.update(req.camp!._id, String(req.params.pid), req.body))
}

export const removePlace: RequestHandler = async (req, res) => {
  await placeService.remove(req.camp!._id, String(req.params.pid))
  res.status(204).end()
}

export const setBoundary: RequestHandler = async (req, res) => {
  res.json(await placeService.setBoundary(req.camp!._id, req.body.boundary))
}
