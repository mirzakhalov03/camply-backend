import type { HydratedDocument } from 'mongoose'
import { CampModel, type Camp } from '../models/camp.model'
import { MembershipModel } from '../models/membership.model'
import { GroupModel } from '../models/group.model'
import { UserModel, type User } from '../models/user.model'
import { HttpError } from '../middlewares/error.middleware'

export type PublicCampStatus = 'draft' | 'upcoming' | 'active' | 'archived'

function deriveStatus(camp: Camp, now = new Date()): PublicCampStatus {
  if (camp.status === 'draft') return 'draft'
  if (camp.archivedAt) return 'archived'
  if (now < camp.startsAt) return 'upcoming'
  if (now > camp.endsAt) return 'archived'
  return 'active'
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmt = (d: Date) => `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`

function dayProgress(camp: Camp, now = new Date()): { dayCurrent: number; dayTotal: number } {
  const DAY = 86_400_000
  const dayTotal = Math.max(1, Math.round((+camp.endsAt - +camp.startsAt) / DAY) + 1)
  if (now < camp.startsAt) return { dayCurrent: 0, dayTotal }
  const elapsed = Math.floor((+now - +camp.startsAt) / DAY) + 1
  return { dayCurrent: Math.min(elapsed, dayTotal), dayTotal }
}

// Counts a camp needs for the dashboard card. One aggregation per camp is fine at
// launch scale; batch later if the list grows.
async function campCounts(campId: Camp['_id']) {
  const [participantCount, organizerCount, groupCount, checkedIn] = await Promise.all([
    MembershipModel.countDocuments({ campId, role: 'participant' }),
    MembershipModel.countDocuments({ campId, role: { $ne: 'participant' } }),
    GroupModel.countDocuments({ campId }),
    MembershipModel.countDocuments({ campId, role: 'participant', checkin: 'in' }),
  ])
  const checkinPct = participantCount === 0 ? 0 : Math.round((checkedIn / participantCount) * 100)
  return { participantCount, organizerCount, groupCount, checkinPct }
}

export async function toOrganizerCamp(camp: Camp) {
  const counts = await campCounts(camp._id)
  return {
    id: String(camp._id),
    name: camp.name,
    location: camp.location,
    dateRange: `${fmt(camp.startsAt)} – ${fmt(camp.endsAt)}`,
    status: deriveStatus(camp),
    coverImage: camp.coverImage ?? null,
    ...counts,
    ...dayProgress(camp),
  }
}

type CreateInput = {
  name: string
  location: string
  startsAt: string
  endsAt: string
  capacity?: number
  languages?: string[]
  coverImage?: string | null
}

export const campService = {
  // Camps this user runs (organizer memberships) — or all org camps for an org caller.
  listForOrganizer: async (user: HydratedDocument<User>) => {
    let camps: Camp[]
    if (user.role === 'organization') {
      camps = await CampModel.find({ organizationId: user._id }).sort({ createdAt: -1 })
    } else {
      const ids = await MembershipModel.find({
        userId: user._id,
        role: { $ne: 'participant' },
      }).distinct('campId')
      camps = await CampModel.find({ _id: { $in: ids } }).sort({ createdAt: -1 })
    }
    return Promise.all(camps.map(toOrganizerCamp))
  },

  getOne: async (camp: Camp) => toOrganizerCamp(camp), // camp resolved by middleware

  // Single-org launch: there is NO organizationId on User. Resolve the one seeded
  // organization here (its _id is the camp's organizationId). When an org account
  // itself creates a camp, it IS the org. Thread a real org id when multi-org lands.
  create: async (input: CreateInput, creator: HydratedDocument<User>) => {
    const organizationId =
      creator.role === 'organization'
        ? creator._id
        : (await UserModel.findOne({ role: 'organization' }).select('_id'))?._id
    if (!organizationId) throw new HttpError(500, 'No organization provisioned')
    const camp = await CampModel.create({
      ...input,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      status: 'draft',
      createdBy: creator._id,
      organizationId,
    })
    // Seed the creator's own organizer-tier membership so one lookup governs access.
    // Use the creator's real phone: the {campId, phone} unique index allows only one
    // empty-phone membership per camp, so '' would collide once a second manager joins.
    await MembershipModel.create({
      campId: camp._id,
      phone: creator.phone ?? `owner:${String(creator._id)}`,
      userId: creator._id,
      role: 'projectManager',
      status: 'active',
    })
    return toOrganizerCamp(camp)
  },

  update: async (camp: HydratedDocument<Camp>, patch: Partial<CreateInput>) => {
    Object.assign(camp, patch, {
      ...(patch.startsAt ? { startsAt: new Date(patch.startsAt) } : {}),
      ...(patch.endsAt ? { endsAt: new Date(patch.endsAt) } : {}),
    })
    await camp.save()
    return toOrganizerCamp(camp)
  },

  publish: async (camp: HydratedDocument<Camp>) => {
    camp.status = 'published'
    await camp.save()
    return toOrganizerCamp(camp)
  },

  archive: async (camp: HydratedDocument<Camp>) => {
    camp.archivedAt = new Date()
    await camp.save()
    return toOrganizerCamp(camp)
  },

  remove: async (camp: Camp) => {
    if (camp.status !== 'draft') throw new HttpError(409, 'Only draft camps can be deleted')
    await CampModel.deleteOne({ _id: camp._id })
    await MembershipModel.deleteMany({ campId: camp._id })
  },

  summary: async (user: HydratedDocument<User>) => {
    const camps = await campService.listForOrganizer(user)
    const activeCamps = camps.filter((c) => c.status === 'active').length
    return {
      organizerName: user.name,
      organizationName: '', // resolved from the single org record when surfaced; '' is contract-valid until then
      totalParticipants: camps.reduce((s, c) => s + c.participantCount, 0),
      activeCamps,
      totalGroups: camps.reduce((s, c) => s + c.groupCount, 0),
      unreadChat: 0, // realtime chat is out of scope — 0 until that lands
      onSite: camps.reduce((s, c) => s + Math.round((c.checkinPct / 100) * c.participantCount), 0),
    }
  },
}
