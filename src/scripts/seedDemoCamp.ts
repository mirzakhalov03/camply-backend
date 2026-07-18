import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDB } from '../config/db'
import { UserModel } from '../models/user.model'
import { CampModel } from '../models/camp.model'
import { GroupModel } from '../models/group.model'
import { MembershipModel, ORGANIZER_SUB_ROLES } from '../models/membership.model'
import { ActivityModel } from '../models/activity.model'
import { AnnouncementModel } from '../models/announcement.model'
import { GroupPointsModel, PointEventModel } from '../models/leaderboard.model'
import { canonicalizePhone } from '../utils/phone'

/*
  DEV-ONLY demo seed. Wipes every camp-scoped collection and rebuilds ONE camp:
  1 manager, 10 organizers, 100 participants — all with real User accounts so the
  manager's board shows names, not phone numbers.

  Why real Users and not just Membership rows: toRosterParticipant reads the name
  off the BOUND user (an unbound row renders an empty name), and teamService
  treats `userId: null` as a *pending invite* rather than a team member. Seeding
  memberships alone would produce a board full of blank rows and phantom invites.

  User accounts are NOT wiped — only camp data. Re-running is safe: it deletes the
  users in its own reserved phone ranges first, so it never collides with itself
  or with accounts a human created.
*/

// Reserved phone ranges — kept distinct so the wipe can't touch real test accounts.
const MANAGER_PHONE = '940000001'
const ORGANIZER_PHONE_BASE = 940001000 // +1 … +10
const PARTICIPANT_PHONE_BASE = 940002000 // +1 … +100

const FIRST_NAMES = [
  'Ali',
  'Dilnoza',
  'Bek',
  'Nodira',
  'Jasur',
  'Kamola',
  'Sardor',
  'Malika',
  'Timur',
  'Zilola',
  'Aziz',
  'Gulnora',
  'Rustam',
  'Sevara',
  'Otabek',
  'Nigora',
  'Farrux',
  'Mohira',
  'Shoxrux',
  'Feruza',
  'Islom',
  'Dilfuza',
  'Javohir',
  'Zarina',
  'Bobur',
  'Nilufar',
  'Sanjar',
  'Aziza',
  'Ulugbek',
  'Shahzoda',
]
const LAST_NAMES = [
  'Valiyev',
  'Karimova',
  'Rustamov',
  'Yusupova',
  'Ergashev',
  'Tursunova',
  'Qodirov',
  'Ibrohimova',
  'Saidov',
  'Nazarova',
  'Mirzayev',
  'Umarova',
  'Xolmatov',
  'Rahimova',
  'Sultonov',
  'Yodgorova',
  'Abdullayev',
  'Sobirova',
]
const CITIES = ['Tashkent', 'Samarkand', 'Bukhara', 'Namangan', 'Andijan', 'Fergana']

// Ten groups, each on a design-system palette token (never a raw hex — the group
// color flows to the participant's avatar tiles, which resolve tokens per theme).
const GROUP_NAMES = [
  'Pine Wolves',
  'Amber Foxes',
  'Sky Falcons',
  'River Otters',
  'Stone Bears',
  'Desert Lynx',
  'Storm Eagles',
  'Forest Deer',
  'Canyon Hawks',
  'Valley Ibex',
]
const GROUP_TOKENS = ['pine', 'amber', 'sky', 'deep']

const pad = (n: number) => String(n)

/*
  30 first names × 18 surnames with a stride of 7 repeats every LCM(30,18) = 90,
  so a naive `i % 30` / `(i * 7) % 18` pairing hands participants 1 and 91 the
  exact same name. Offsetting the surname by the first-name lap count breaks that
  cycle, which matters here: 100 people is enough that duplicates are obvious.
*/
function personAt(i: number) {
  const lap = Math.floor(i / FIRST_NAMES.length)
  return {
    name: FIRST_NAMES[i % FIRST_NAMES.length],
    surname: LAST_NAMES[(i * 7 + lap) % LAST_NAMES.length],
    cityId: CITIES[i % CITIES.length],
    age: 16 + (i % 12),
  }
}

async function seedDemoCamp() {
  await connectDB()

  // ── 1. Wipe camp data (user accounts and sessions are deliberately preserved) ──
  const wiped = await Promise.all([
    CampModel.deleteMany({}),
    GroupModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    ActivityModel.deleteMany({}),
    AnnouncementModel.deleteMany({}),
    GroupPointsModel.deleteMany({}),
    PointEventModel.deleteMany({}),
  ])
  console.log(
    '🧹 Wiped camp data — camps:%d groups:%d memberships:%d activities:%d announcements:%d points:%d events:%d',
    ...wiped.map((r) => r.deletedCount),
  )

  // ── 2. The organization (created by npm run seed:org) owns every camp ──
  const org = await UserModel.findOne({ role: 'organization' })
  if (!org) throw new Error('No organization found — run `npm run seed:org` first.')

  // Clear only THIS script's reserved phone ranges so re-runs are idempotent
  // without disturbing accounts a human made.
  const reserved = [
    canonicalizePhone(MANAGER_PHONE),
    ...Array.from({ length: 10 }, (_, i) => canonicalizePhone(pad(ORGANIZER_PHONE_BASE + i + 1))),
    ...Array.from({ length: 100 }, (_, i) =>
      canonicalizePhone(pad(PARTICIPANT_PHONE_BASE + i + 1)),
    ),
  ]
  const purged = await UserModel.deleteMany({ phone: { $in: reserved } })
  console.log('🧹 Cleared %d previously seeded demo accounts', purged.deletedCount)

  // ── 3. The manager — accepted + active so they can log in by phone ──
  // authService.login rejects a manager/organizer with no acceptedAt, so a demo
  // account without it would exist but be unable to sign in.
  const managerPhone = canonicalizePhone(MANAGER_PHONE)
  const manager = await UserModel.create({
    phone: managerPhone,
    name: 'Javohir',
    surname: 'Mirzakhalov',
    role: 'manager',
    active: true,
    acceptedAt: new Date(),
    cityId: 'Tashkent',
    age: 28,
  })

  // ── 4. The camp — dated around today so status derives to 'active' ──
  const now = Date.now()
  const DAY = 86_400_000
  const camp = await CampModel.create({
    name: 'Camply Summer Camp 2026',
    location: 'Chimgan Mountains',
    startsAt: new Date(now - 3 * DAY),
    endsAt: new Date(now + 11 * DAY),
    capacity: 120,
    languages: ['uz', 'ru', 'en'],
    status: 'published',
    createdBy: manager._id,
    organizationId: org._id,
  })

  // The manager's own camp row — one membership lookup governs all camp access.
  await MembershipModel.create({
    campId: camp._id,
    phone: managerPhone,
    userId: manager._id,
    role: 'manager',
    status: 'active',
    checkin: 'in',
  })

  // ── 5. Groups (+ their leaderboard rows, so standings exist from day one) ──
  const groups = await Promise.all(
    GROUP_NAMES.map((name, i) =>
      GroupModel.create({ campId: camp._id, name, color: GROUP_TOKENS[i % GROUP_TOKENS.length] }),
    ),
  )
  await Promise.all(
    groups.map((g, i) =>
      GroupPointsModel.create({
        campId: camp._id,
        groupId: g._id,
        activities: 40 + ((i * 13) % 60),
        attendance: 30 + ((i * 7) % 40),
        challenges: 10 + ((i * 11) % 30),
        previousScore: 60 + ((i * 17) % 50),
      }),
    ),
  )

  // ── 6. Ten organizers — bound users, so the team board shows members not invites ──
  for (let i = 0; i < 10; i++) {
    const p = personAt(i + 3)
    const phone = canonicalizePhone(pad(ORGANIZER_PHONE_BASE + i + 1))
    const user = await UserModel.create({
      phone,
      name: p.name,
      surname: p.surname,
      role: 'organizer',
      active: true,
      acceptedAt: new Date(),
      cityId: p.cityId,
      age: 22 + (i % 8),
      subRole: ORGANIZER_SUB_ROLES[i % ORGANIZER_SUB_ROLES.length],
    })
    await MembershipModel.create({
      campId: camp._id,
      phone,
      userId: user._id,
      role: ORGANIZER_SUB_ROLES[i % ORGANIZER_SUB_ROLES.length],
      status: 'active',
      checkin: 'in',
    })
  }

  // ── 7. One hundred participants, spread ten per group ──
  for (let i = 0; i < 100; i++) {
    const p = personAt(i)
    const phone = canonicalizePhone(pad(PARTICIPANT_PHONE_BASE + i + 1))
    const user = await UserModel.create({
      phone,
      name: p.name,
      surname: p.surname,
      role: 'participant',
      active: true,
      cityId: p.cityId,
      age: p.age,
    })
    await MembershipModel.create({
      campId: camp._id,
      phone,
      userId: user._id,
      groupId: groups[i % groups.length]._id,
      role: 'participant',
      status: 'active',
      checkin: i % 4 === 0 ? 'out' : 'in',
    })
  }

  console.log('\n✅ Seeded camp: %s (%s)', camp.name, String(camp._id))
  console.log('   manager      %s  (Javohir Mirzakhalov)', managerPhone)
  console.log(
    '   organizers   %s … %s  (10)',
    canonicalizePhone(pad(ORGANIZER_PHONE_BASE + 1)),
    canonicalizePhone(pad(ORGANIZER_PHONE_BASE + 10)),
  )
  console.log(
    '   participants %s … %s  (100, 10 per group)',
    canonicalizePhone(pad(PARTICIPANT_PHONE_BASE + 1)),
    canonicalizePhone(pad(PARTICIPANT_PHONE_BASE + 100)),
  )
  console.log('   groups       %d', groups.length)

  await mongoose.disconnect()
}

seedDemoCamp().catch(async (err) => {
  console.error('❌ Seed failed:', err)
  await mongoose.disconnect()
  process.exit(1)
})
