import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware'
import { validate } from '../middlewares/validate.middleware'
import { subscribeSchema, unsubscribeSchema } from '../validators/push.validators'
import { subscribe, unsubscribe } from '../controllers/push.controllers'

const router = Router()

router.post('/subscribe', requireAuth, validate({ body: subscribeSchema }), subscribe)
router.delete('/subscribe', requireAuth, validate({ body: unsubscribeSchema }), unsubscribe)

export default router
