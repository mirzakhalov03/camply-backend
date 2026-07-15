import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import { CampModel } from '../models/camp.model'
import { UserModel } from '../models/user.model'

// Dev migration (2026-07-15): under the new hierarchy, camps are created and owned by
// managers, not organizers. Any organizer who already created a camp is promoted to
// `manager`. Idempotent — a re-run promotes only whoever is still an organizer.
async function promoteCampCreators() {
  await connectDB()
  const creatorIds = await CampModel.distinct('createdBy')
  const result = await UserModel.updateMany(
    { _id: { $in: creatorIds }, role: 'organizer' },
    { $set: { role: 'manager' } },
  )
  console.log(`✅ Promoted ${result.modifiedCount} organizer(s) to manager.`)
  await mongoose.disconnect()
}

promoteCampCreators()
