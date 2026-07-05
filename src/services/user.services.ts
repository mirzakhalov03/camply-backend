import { UserModel } from '../models/user.model'
import { HttpError } from '../middlewares/error.middleware'
import type { CreateUserInput } from '../validators/user.validators'

// Services hold business/data logic — controllers stay thin and only deal
// with HTTP concerns.
export const userService = {
  list: () => UserModel.find().sort({ createdAt: -1 }).lean(),

  getById: async (id: string) => {
    const user = await UserModel.findById(id).lean()
    if (!user) throw new HttpError(404, 'User not found')
    return user
  },

  create: async (input: CreateUserInput) => {
    const exists = await UserModel.exists({ email: input.email })
    if (exists) throw new HttpError(409, 'Email already in use')
    return UserModel.create(input)
  },
}
