import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import { UserModel } from '../models/user.model'
import { canonicalizePhone } from '../utils/phone'

// Dev-only: stands in for the organizer app (not built yet), which is the ONLY
// real way participants get created. Seeds sample participants with an INCOMPLETE
// profile (no city/age/photo) — exactly what each one completes on first login.
const SAMPLE_PARTICIPANTS = [
  { phone: '901234567', name: 'Ali', surname: 'Valiyev' },
  { phone: '902345678', name: 'Dilnoza', surname: 'Karimova' },
  { phone: '903456789', name: 'Bek', surname: 'Rustamov' },
]

async function seedParticipants() {
  await connectDB()
  for (const p of SAMPLE_PARTICIPANTS) {
    const phone = canonicalizePhone(p.phone)
    const existing = await UserModel.findOne({ phone })
    if (existing) {
      console.log('ℹ️  Participant already exists:', phone)
      continue
    }
    await UserModel.create({ phone, name: p.name, surname: p.surname, role: 'participant' })
    console.log('✅ Participant seeded:', phone, `(${p.name} ${p.surname})`)
  }
  await mongoose.disconnect()
}

seedParticipants()
