import mongoose from 'mongoose'
import { env } from '../config/env'

/*
  One-shot migration: remove the retired `checkin` field from every membership.
  Idempotent — re-running it is a no-op once the field is gone.

  Attendance check-in was removed from the product on 2026-07-20, along with the
  derived `checkinPct` / `onSite` stats it fed.
*/
async function main() {
  await mongoose.connect(env.MONGO_URI)
  const result = await mongoose.connection
    .collection('memberships')
    .updateMany({ checkin: { $exists: true } }, { $unset: { checkin: '' } })
  console.log(`✅ Cleared checkin from ${result.modifiedCount} membership(s)`)
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})
