import type { Types } from 'mongoose'
import { LocationModel } from '../models/location.model'
import { PlaceModel } from '../models/place.model'
import { MembershipModel } from '../models/membership.model'
import { UserModel } from '../models/user.model'
import { CampModel } from '../models/camp.model'
import { initialsOf, colorFor } from '../utils/avatar'
import { resolveZoneId, evaluateBounds, type Coords, type ZoneLike } from '../utils/geo'
import { HttpError } from '../middlewares/error.middleware'

export type Pin = {
  userId: string
  name: string
  initials: string
  color: string
  groupId: string | null
  lat: number
  lon: number
  zoneId: string | null
  outOfBounds: boolean
  at: string
}

/** Staff-only. NO COORDINATES, ever — this is the sharing-off projection. */
export type HiddenPin = {
  userId: string
  name: string
  initials: string
  outOfBounds: boolean
}

export type ReportResult = {
  pin: Pin | null
  hidden: HiddenPin | null
  groupId: string | null
  /** Did outOfBounds flip? Staff are only notified on a change, not every 60s. */
  changed: boolean
}

/** Name/surname stay optional until completeProfile, so never fall back to phone. */
function labelOf(user: { name?: string | null; surname?: string | null } | null) {
  return user ? `${user.name ?? ''} ${user.surname ?? ''}`.trim() : ''
}

async function zonesOf(campId: Types.ObjectId): Promise<ZoneLike[]> {
  const zones = await PlaceModel.find({ campId, kind: 'zone' }).select('_id center radiusM').lean()
  return zones
    .filter((z) => z.radiusM != null)
    .map((z) => ({
      id: String(z._id),
      center: { lat: z.center.lat, lon: z.center.lon },
      radiusM: z.radiusM as number,
    }))
}

export const locationService = {
  /*
    THE WRITE PATH. Order matters:

      1. camp-hours gate (server is the authority, not the client)
      2. resolve zone + bounds from the incoming fix
      3. DISCARD coordinates if sharing is off
      4. upsert
      5. hand the caller what to broadcast — this service decides visibility,
         the socket layer only delivers it

    Coordinates are discarded at step 3 rather than filtered at read time: that is
    the difference between "we don't store it" and "we store it but hide it".

    The four independent reads run in ONE round trip. The DB is remote, so each
    sequential await costs ~180ms of pure latency (the lesson chat's membersFrom
    learned) — and this path runs once per participant per 15-60s.
  */
  report: async (args: {
    campId: Types.ObjectId
    userId: Types.ObjectId
    pos: Coords
    accuracyM: number
  }): Promise<ReportResult> => {
    const { campId, userId, pos, accuracyM } = args

    const [camp, membership, prevDoc, user] = await Promise.all([
      CampModel.findById(campId).select('boundary startsAt endsAt'),
      MembershipModel.findOne({ campId, userId }).select('groupId shareLocation'),
      LocationModel.findOne({ campId, userId }).select('outOfBounds obStreak'),
      UserModel.findById(userId).select('name surname'),
    ])

    if (!camp) throw new HttpError(404, 'Camp not found')

    const now = new Date()
    if (now < camp.startsAt || now > camp.endsAt) {
      throw new HttpError(403, 'Camp is not running')
    }
    if (!membership) throw new HttpError(403, 'Not a member of this camp')

    const prev = {
      outOfBounds: prevDoc?.outOfBounds ?? false,
      obStreak: prevDoc?.obStreak ?? 0,
    }

    const boundary = camp.boundary
      ? {
          center: { lat: camp.boundary.center!.lat, lon: camp.boundary.center!.lon },
          radiusM: camp.boundary.radiusM,
        }
      : null

    const bounds = evaluateBounds({ pos, boundary, accuracyM, prev })
    const sharing = membership.shareLocation !== false
    // Only pay for the zone lookup when there is a coordinate to place in a zone.
    const zoneId = sharing ? resolveZoneId(pos, await zonesOf(campId)) : null

    await LocationModel.updateOne(
      { campId, userId },
      {
        $set: {
          // Sharing off ⇒ nothing locating is written at all.
          lat: sharing ? pos.lat : null,
          lon: sharing ? pos.lon : null,
          accuracyM,
          zoneId,
          outOfBounds: bounds.outOfBounds,
          obStreak: bounds.obStreak,
          reportedAt: now,
        },
      },
      { upsert: true },
    )

    const label = labelOf(user)
    const initials = label ? initialsOf(label) : '?'
    const groupId = membership.groupId ? String(membership.groupId) : null
    const changed = prev.outOfBounds !== bounds.outOfBounds

    if (!sharing) {
      return {
        pin: null,
        hidden: { userId: String(userId), name: label, initials, outOfBounds: bounds.outOfBounds },
        groupId,
        changed,
      }
    }

    return {
      pin: {
        userId: String(userId),
        name: label,
        initials,
        color: colorFor(String(userId)),
        groupId,
        lat: pos.lat,
        lon: pos.lon,
        zoneId,
        outOfBounds: bounds.outOfBounds,
        at: now.toISOString(),
      },
      hidden: null,
      groupId,
      changed,
    }
  },

  /*
    Cold-open projection, scoped per design §5.1.

      participant → their OWN group only, sharing-on only, no `hidden` key at all
      staff       → the whole camp, plus `hidden[]` for sharing-off people who are
                    out of bounds (boolean only, never coordinates)

    An UNASSIGNED participant (groupId null) sees only themselves. Matching on
    `groupId: null` would pool every ungrouped participant into a pseudo-group and
    show them each other's positions — "no group" is not a group, and §5.1 grants
    visibility to your group, not to everyone who lacks one.

    Batched with $in + a Map — never a findById inside a loop (see chatService).
  */
  pinsFor: async (
    camp: { _id: Types.ObjectId },
    viewer: { userId: Types.ObjectId; groupId?: Types.ObjectId | null },
    isStaff: boolean,
  ) => {
    const campId = camp._id

    const memberQuery: Record<string, unknown> = { campId, role: 'participant' }
    if (!isStaff) {
      memberQuery.groupId = viewer.groupId ?? null
      // No group ⇒ no groupmates. Narrow to self rather than to "the ungrouped".
      if (!viewer.groupId) memberQuery.userId = viewer.userId
    }

    const [members, own] = await Promise.all([
      MembershipModel.find(memberQuery).select('userId groupId').lean(),
      MembershipModel.findOne({ campId, userId: viewer.userId }).select('shareLocation').lean(),
    ])

    const userIds = members.map((m) => m.userId).filter(Boolean) as Types.ObjectId[]
    const [locs, users] = await Promise.all([
      LocationModel.find({ campId, userId: { $in: userIds } }).lean(),
      UserModel.find({ _id: { $in: userIds } })
        .select('name surname')
        .lean(),
    ])
    const locBy = new Map(locs.map((l) => [String(l.userId), l]))
    const userBy = new Map(users.map((u) => [String(u._id), u]))
    const groupBy = new Map(members.map((m) => [String(m.userId), m.groupId]))

    const pins: Pin[] = []
    const hidden: HiddenPin[] = []

    for (const uid of userIds.map(String)) {
      const loc = locBy.get(uid)
      if (!loc) continue
      const label = labelOf(userBy.get(uid) ?? null)
      const initials = label ? initialsOf(label) : '?'

      if (loc.lat == null || loc.lon == null) {
        // Sharing off. Staff learn only that they've left; nobody else hears anything.
        if (isStaff && loc.outOfBounds) {
          hidden.push({ userId: uid, name: label, initials, outOfBounds: true })
        }
        continue
      }
      const gid = groupBy.get(uid)
      pins.push({
        userId: uid,
        name: label,
        initials,
        color: colorFor(uid),
        groupId: gid ? String(gid) : null,
        lat: loc.lat,
        lon: loc.lon,
        zoneId: loc.zoneId ? String(loc.zoneId) : null,
        outOfBounds: loc.outOfBounds ?? false,
        at: new Date(loc.reportedAt).toISOString(),
      })
    }

    return {
      pins,
      ...(isStaff ? { hidden } : {}),
      sharing: own ? own.shareLocation !== false : true,
    }
  },

  /*
    Flip the caller's own sharing. Turning it OFF immediately scrubs the stored
    coordinates — waiting for the next report would leave a last-known position
    readable for up to a minute after the user asked us to stop.
  */
  setSharing: async (campId: Types.ObjectId, userId: Types.ObjectId, enabled: boolean) => {
    const m = await MembershipModel.findOneAndUpdate(
      { campId, userId },
      { $set: { shareLocation: enabled } },
      { new: true },
    ).select('shareLocation')
    if (!m) throw new HttpError(403, 'Not a member of this camp')

    if (!enabled) {
      await LocationModel.updateOne(
        { campId, userId },
        { $set: { lat: null, lon: null, zoneId: null } },
      )
    }
    return { sharing: m.shareLocation !== false }
  },
}
