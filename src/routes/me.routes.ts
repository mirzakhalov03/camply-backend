import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware'
import { listMyCamps } from '../controllers/me.controllers'

// The caller's own view of their memberships. No requireRole: this router is
// self-scoped, so every authenticated role resolves only its own rows.
const router = Router()
router.use(requireAuth)
router.get('/camps', listMyCamps)

export default router
