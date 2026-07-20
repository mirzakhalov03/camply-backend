import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import { UserModel } from '../models/user.model'
import { CampModel } from '../models/camp.model'
import { GroupModel } from '../models/group.model'
import { MembershipModel } from '../models/membership.model'
import { canonicalizePhone } from '../utils/phone'

/*
  Dev-only: fills the HackUnicorn camp with 100 participants spread evenly across
  its 10 groups, so the roster/groups/leaderboard screens have realistic volume to
  render against.

  Unlike `seedParticipants.ts` (which only creates Users), this seeds the FULL
  claimed state — a participant `User` plus an `active` `Membership` bound to it —
  because the roster resolves display names through `membership.userId`
  (roster.services.ts). Membership-only rows would render as blank names.

  Everything is DETERMINISTIC (no randomness) and keyed on phone, so a re-run is a
  no-op rather than a second batch of near-duplicate people.

  Run: npx tsx src/scripts/seedHackUnicorn.ts
*/

const CAMP_NAME = 'HackUnicorn'
const SEED_COUNT = 100

// A reserved, contiguous phone block that no real account uses (+998901200001…100).
// Keeping seeds in one block makes them trivial to identify and clean up later.
const PHONE_BLOCK_START = 901200001

// 20 first names × 21 surnames — coprime lengths, so index-pairing yields 100
// distinct full names without needing a 100-entry table.
const FIRST_NAMES = [
  'Ali',
  'Dilnoza',
  'Bek',
  'Zilola',
  'Javohir',
  'Madina',
  'Sardor',
  'Nilufar',
  'Aziz',
  'Kamola',
  'Jasur',
  'Sevara',
  'Rustam',
  'Gulnora',
  'Otabek',
  'Malika',
  'Sherzod',
  'Feruza',
  'Bobur',
  'Nodira',
]

const SURNAMES = [
  'Valiyev',
  'Karimova',
  'Rustamov',
  'Yusupova',
  'Tosheva',
  'Abdullayev',
  'Ismoilova',
  'Nazarov',
  'Saidova',
  'Qodirov',
  'Ergasheva',
  'Mirzayev',
  'Umarova',
  'Xolmatov',
  'Rahimova',
  'Tursunov',
  'Yuldasheva',
  'Sobirov',
  'Alimova',
  'Nurmatov',
  'Hasanova',
]

const CITIES = [
  'Tashkent',
  'Samarkand',
  'Bukhara',
  'Namangan',
  'Andijan',
  'Fergana',
  'Nukus',
  'Qarshi',
  'Urgench',
  'Jizzakh',
]

/** Deterministic person #i (0-based) — same input, same human, every run. */
function personAt(i: number) {
  return {
    phone: canonicalizePhone(String(PHONE_BLOCK_START + i)),
    name: FIRST_NAMES[i % FIRST_NAMES.length],
    surname: SURNAMES[i % SURNAMES.length],
    cityId: CITIES[i % CITIES.length],
    age: 16 + (i % 9), // 16–24, the camp's realistic age band
  }
}

async function seedHackUnicorn() {
  await connectDB()

  const camp = await CampModel.findOne({ name: CAMP_NAME })
  if (!camp) throw new Error(`Camp "${CAMP_NAME}" not found`)

  // Creation order (Apple → Tesla) is the organizer's own ordering; keep it stable
  // so a re-run assigns the same person to the same group.
  const groups = await GroupModel.find({ campId: camp._id }).sort({ createdAt: 1 })
  if (groups.length === 0) throw new Error(`Camp "${CAMP_NAME}" has no groups`)

  const perGroup = Math.floor(SEED_COUNT / groups.length)
  console.log(`Seeding ${SEED_COUNT} participants into ${groups.length} groups (${perGroup} each)…`)

  let usersCreated = 0
  let membershipsCreated = 0
  let skipped = 0

  for (let i = 0; i < SEED_COUNT; i++) {
    const p = personAt(i)
    const group = groups[Math.min(Math.floor(i / perGroup), groups.length - 1)]

    let user = await UserModel.findOne({ phone: p.phone })
    if (!user) {
      user = await UserModel.create({
        phone: p.phone,
        name: p.name,
        surname: p.surname,
        cityId: p.cityId,
        age: p.age,
        role: 'participant',
        active: true,
      })
      usersCreated++
    }

    const existing = await MembershipModel.findOne({ campId: camp._id, phone: p.phone })
    if (existing) {
      skipped++
      continue
    }

    await MembershipModel.create({
      campId: camp._id,
      phone: p.phone,
      userId: user._id,
      groupId: group._id,
      role: 'participant',
      status: 'active', // already claimed — these seeds stand in for people who logged in
    })
    membershipsCreated++
  }

  console.log(
    `✅ Done — ${usersCreated} user(s) created, ${membershipsCreated} membership(s) created, ${skipped} already present.`,
  )
  await mongoose.disconnect()
}

seedHackUnicorn().catch(async (err) => {
  console.error('❌ Seed failed:', err.message)
  await mongoose.disconnect()
  process.exit(1)
})
