import { Router } from 'express'
import userRoutes from './user.routes'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

router.use('/users', userRoutes)

export default router
