import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { createUserSchema, userIdParamSchema } from '../validators/user.validators'
import { createUser, getUser, listUsers } from '../controllers/user.controllers'

const router = Router()

router.get('/', listUsers)
router.get('/:id', validate({ params: userIdParamSchema }), getUser)
router.post('/', validate({ body: createUserSchema }), createUser)

export default router
