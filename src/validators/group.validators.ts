import { z } from '../config/zod'
import { uploadRefSchema } from './upload.validators'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')

export const groupIdParams = z.object({ id: objectId, gid: objectId })
export const createGroupSchema = z.object({ name: z.string().min(1), color: z.string().min(1) })
export const updateGroupSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  leaderMembershipId: objectId.nullable().optional(),
  // Group-identity photo, manager-tier. Members set the same field through
  // myGroupPhotoSchema on the member-level route below.
  photo: uploadRefSchema.nullable().optional(),
})

/*
  PATCH /camps/:id/my-group/photo — the MEMBER-level write. Only `photo`: name,
  color and leadership stay manager-tier, so this body can't be widened into a
  group takeover by adding a field. `null` clears it back to the emoji tile.
*/
export const myGroupPhotoSchema = z.object({ photo: uploadRefSchema.nullable() })
