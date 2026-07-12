# Organizer CRUD & Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend models, endpoints, permissions, and response projections that make the Camply organizer view real, and flip each frontend service from mock → live.

**Architecture:** Six new Mongoose models (`Camp`, `Group`, `Membership`, `Activity`, `Announcement`, `GroupPoints`/`PointEvent`) behind the existing `routes → controllers → services → models` layering. Two new camp-scoping middlewares (`requireCampMember`, `requireCampManager`) extend the existing `requireAuth`/`requireRole`. Membership is phone-keyed and binds to a `User` on signup. Each domain ships as a slice: model → validators → service (with a `toPublic*` projection) → thin controllers → routes → OpenAPI registration → frontend flip.

**Tech Stack:** Express 5, Mongoose 9, Zod 4 (import `z` from `config/zod`), TypeScript strict/CommonJS, `@asteasolutions/zod-to-openapi`. Frontend: React 19 + React Query + axios.

**Design spec:** `docs/superpowers/specs/2026-07-12-organizer-crud-endpoints-design.md`

## Global Constraints

- **No test runner** — do NOT add or suggest tests (project preference). Per-change gate is `npm run typecheck` (`tsc --noEmit`); full gate is `npm run validate` (lint + format:check + typecheck). Verify behavior manually via `/api/docs` (Swagger) or curl.
- **Layering:** `routes → controllers → services → models`. Controllers are **thin** — no try/catch (Express 5 forwards async throws). All logic in services. Throw `new HttpError(status, message)`.
- **Validation:** every input a Zod schema in `validators/`, applied via `validate({ body, params, query })`. **Import `z` from `config/zod`**, never `'zod'`.
- **Env:** all config through `config/env.ts`. Never read `process.env` elsewhere.
- **Docs:** add `registry.registerPath(...)` in `docs/openapi.ts` for every endpoint, reusing validator schemas.
- **Role hierarchy:** `participant < organizer < organization` (`RANK` in `auth.middleware.ts`). A hidden button is not a permission — server is the sole authority. Organizers cannot mint peer organizers.
- **Prettier:** no semicolons, single quotes, trailing commas, width 100. Format touched files with `npx prettier --write --end-of-line auto <files>`.
- **Frontend flip = uncomment the axios line, delete the mock branch.** The contract types are already the return types — no UI change.

---

### Task 1: Restore dependencies (prerequisite)

`node_modules` is missing `nodemailer` (already in `package.json`), so `tsc` currently fails on `mailer.service.ts`. Every later task's typecheck gate depends on this.

**Files:** none (environment only)

- [ ] **Step 1: Install deps**

Run: `cd /Users/mn.afridi/Desktop/Camply/Backend && npm install`

- [ ] **Step 2: Verify typecheck is green on the untouched tree**

Run: `npm run typecheck`
Expected: PASS (no errors). If `nodemailer` still errors, run `npm install nodemailer@^9.0.3 @types/nodemailer@^8.0.1`.

- [ ] **Step 3: Confirm dev server boots**

Run: `npm run dev` (needs `MONGO_URI`). Expected: listening on `:4000`, `/api/docs` loads. Stop it after confirming.

---

### Task 2: The six data models

All models in `src/models/`. Follow `user.model.ts` conventions: `InferSchemaType`, exported enum consts, `timestamps: true`.

**Files:**
- Create: `src/models/camp.model.ts`
- Create: `src/models/group.model.ts`
- Create: `src/models/membership.model.ts`
- Create: `src/models/activity.model.ts`
- Create: `src/models/announcement.model.ts`
- Create: `src/models/leaderboard.model.ts` (GroupPoints + PointEvent)

**Interfaces:**
- Produces: `CampModel`, `Camp`, `CAMP_STORED_STATUS`; `GroupModel`, `Group`; `MembershipModel`, `Membership`, `MEMBERSHIP_ROLES`, `ORGANIZER_SUB_ROLES`, `CHECKIN_STATUS`; `ActivityModel`, `Activity`; `AnnouncementModel`, `Announcement`; `GroupPointsModel`, `PointEventModel`, `POINT_CATEGORIES`.

- [ ] **Step 1: Write `camp.model.ts`**

```ts
import { Schema, model, Types, type InferSchemaType } from 'mongoose'

// Only draft/published are STORED. The public upcoming/active/archived status is
// derived from dates in the projection (see camp.services toOrganizerCamp).
export const CAMP_STORED_STATUS = ['draft', 'published'] as const

const campSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    capacity: { type: Number, default: 0 },
    languages: { type: [String], default: [] }, // subset of en/uz/ru
    coverImage: { type: String, default: null },
    status: { type: String, enum: CAMP_STORED_STATUS, default: 'draft', required: true },
    archivedAt: { type: Date, default: null }, // manual archive of a still-dated camp
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

export type Camp = InferSchemaType<typeof campSchema> & { _id: Types.ObjectId }
export const CampModel = model('Camp', campSchema)
```

- [ ] **Step 2: Write `group.model.ts`**

```ts
import { Schema, model, Types, type InferSchemaType } from 'mongoose'

const groupSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, required: true }, // palette token e.g. 'pine'
    leaderMembershipId: { type: Schema.Types.ObjectId, ref: 'Membership', default: null },
    photo: { type: String, default: null },
  },
  { timestamps: true },
)

export type Group = InferSchemaType<typeof groupSchema> & { _id: Types.ObjectId }
export const GroupModel = model('Group', groupSchema)
```

- [ ] **Step 3: Write `membership.model.ts`**

```ts
import { Schema, model, Types, type InferSchemaType } from 'mongoose'

// The 7 canonical organizer sub-roles (frontend components/organizer/roles.ts).
// Any of these is "organizer-tier" and grants camp management. Granular per-role
// permission enforcement is post-launch (CONTEXT §7) — captured, not gated.
export const ORGANIZER_SUB_ROLES = [
  'projectManager',
  'coordinator',
  'admin',
  'media',
  'brandFace',
  'eventManager',
  'photographer',
] as const

export const MEMBERSHIP_ROLES = ['participant', ...ORGANIZER_SUB_ROLES] as const
export const CHECKIN_STATUS = ['in', 'out'] as const
export const MEMBERSHIP_STATUS = ['pending', 'active'] as const

const membershipSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true },
    phone: { type: String, required: true, trim: true }, // E.164 — the join key
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // bound on signup
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    role: { type: String, enum: MEMBERSHIP_ROLES, default: 'participant', required: true },
    checkin: { type: String, enum: CHECKIN_STATUS, default: 'out', required: true },
    status: { type: String, enum: MEMBERSHIP_STATUS, default: 'pending', required: true },
  },
  { timestamps: true },
)

// One membership per phone per camp.
membershipSchema.index({ campId: 1, phone: 1 }, { unique: true })
// The ≤2-camps check and signup binding both query by phone.
membershipSchema.index({ phone: 1, role: 1 })

export type Membership = InferSchemaType<typeof membershipSchema> & { _id: Types.ObjectId }
export const MembershipModel = model('Membership', membershipSchema)
```

- [ ] **Step 4: Write `activity.model.ts`**

```ts
import { Schema, model, Types, type InferSchemaType } from 'mongoose'

export const ACTIVITY_SCOPE = ['camp', 'group'] as const

const activitySchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    title: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    scope: { type: String, enum: ACTIVITY_SCOPE, default: 'camp', required: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    description: { type: String, default: null },
  },
  { timestamps: true },
)

export type Activity = InferSchemaType<typeof activitySchema> & { _id: Types.ObjectId }
export const ActivityModel = model('Activity', activitySchema)
```

- [ ] **Step 5: Write `announcement.model.ts`**

```ts
import { Schema, model, Types, type InferSchemaType } from 'mongoose'

export const ANNOUNCEMENT_SCOPE = ['camp', 'group'] as const

const announcementSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    title: { type: String, default: null, trim: true },
    body: { type: String, required: true },
    scope: { type: String, enum: ANNOUNCEMENT_SCOPE, default: 'camp', required: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    pinned: { type: Boolean, default: false, required: true },
  },
  { timestamps: true },
)

export type Announcement = InferSchemaType<typeof announcementSchema> & { _id: Types.ObjectId }
export const AnnouncementModel = model('Announcement', announcementSchema)
```

- [ ] **Step 6: Write `leaderboard.model.ts`**

```ts
import { Schema, model, Types, type InferSchemaType } from 'mongoose'

export const POINT_CATEGORIES = ['activities', 'attendance', 'challenges'] as const

const groupPointsSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    activities: { type: Number, default: 0 },
    attendance: { type: Number, default: 0 },
    challenges: { type: Number, default: 0 },
    previousScore: { type: Number, default: 0 }, // snapshot → drives the trend arrow
  },
  { timestamps: true },
)
groupPointsSchema.index({ campId: 1, groupId: 1 }, { unique: true })

const pointEventSchema = new Schema(
  {
    campId: { type: Schema.Types.ObjectId, ref: 'Camp', required: true, index: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    category: { type: String, enum: POINT_CATEGORIES, required: true },
    delta: { type: Number, required: true },
    byUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

export type GroupPoints = InferSchemaType<typeof groupPointsSchema> & { _id: Types.ObjectId }
export type PointEvent = InferSchemaType<typeof pointEventSchema> & { _id: Types.ObjectId }
export const GroupPointsModel = model('GroupPoints', groupPointsSchema)
export const PointEventModel = model('PointEvent', pointEventSchema)
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS. Fix any type errors (usually a missing import or an `as const` slip).

- [ ] **Step 8: Commit**

```bash
git add src/models/
git commit -m "feat(models): camp, group, membership, activity, announcement, leaderboard"
```

---

### Task 3: Camp-scoping middleware

**Files:**
- Create: `src/middlewares/campScope.middleware.ts`
- Modify: `src/types/express.d.ts` (or wherever `req.auth` is augmented — grep for `declare global` / `req.auth`)

**Interfaces:**
- Consumes: `req.auth.user` (from `requireAuth`), `CampModel`, `MembershipModel`, `ORGANIZER_SUB_ROLES`.
- Produces: `requireCampMember`, `requireCampManager` middlewares; augments `Request` with `req.camp: Camp` and `req.membership: Membership | null`.

- [ ] **Step 1: Find the existing `req.auth` type augmentation**

Run: `grep -rn "req.auth\|declare global\|Request {" src/`
Note the file that augments Express `Request` (the auth design added it). Add `camp` and `membership` to the same interface.

- [ ] **Step 2: Augment the Request type**

In that augmentation file, add to the `Request` interface:

```ts
import type { Camp } from '../models/camp.model'
import type { Membership } from '../models/membership.model'
// ...inside the augmented Request interface:
camp?: Camp
membership?: Membership | null
```

- [ ] **Step 3: Write `campScope.middleware.ts`**

```ts
import type { RequestHandler } from 'express'
import { CampModel } from '../models/camp.model'
import { MembershipModel, ORGANIZER_SUB_ROLES } from '../models/membership.model'
import { HttpError } from './error.middleware'

const isOrganizerTier = (role: string): boolean =>
  (ORGANIZER_SUB_ROLES as readonly string[]).includes(role)

// AUTHORIZATION (camp scope) — "may you touch THIS camp?". Compose AFTER requireAuth.
// Loads the camp + the caller's membership, attaches both. Reads use this.
export const requireCampMember: RequestHandler = async (req, _res, next) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated')
  const campId = req.params.id ?? req.params.campId
  const camp = await CampModel.findById(campId)
  if (!camp) throw new HttpError(404, 'Camp not found')

  const { user } = req.auth
  // The organization super-admin sees any camp in its org.
  if (user.role === 'organization') {
    if (String(camp.organizationId) !== String(user._id)) {
      throw new HttpError(403, 'Not your camp')
    }
    req.camp = camp
    req.membership = null
    return next()
  }

  const membership = await MembershipModel.findOne({ campId: camp._id, userId: user._id })
  if (!membership) throw new HttpError(403, 'Not a member of this camp')
  req.camp = camp
  req.membership = membership
  next()
}

// Writes use this — organizer-tier membership, the org, or the camp creator.
export const requireCampManager: RequestHandler = (req, _res, next) => {
  if (!req.camp || !req.auth) throw new HttpError(401, 'Not authenticated')
  const { user } = req.auth
  const isOrg = user.role === 'organization'
  const isCreator = String(req.camp.createdBy) === String(user._id)
  const isManager = req.membership != null && isOrganizerTier(req.membership.role)
  if (!isOrg && !isCreator && !isManager) throw new HttpError(403, 'Insufficient permissions')
  next()
}
```

Note: `requireCampManager` assumes `requireCampMember` ran first (it reads `req.camp`). Always compose them together: `requireAuth, requireCampMember, requireCampManager`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If `user._id` errors as `unknown`, cast via `String(user._id)` (already done above) or type the augmentation's `user` as the `User & { _id }`.

- [ ] **Step 5: Commit**

```bash
git add src/middlewares/campScope.middleware.ts src/types/
git commit -m "feat(middleware): camp-scoping requireCampMember/requireCampManager"
```

---

### Task 4: Camps domain (the worked example)

The reference implementation every later domain mirrors. Full CRUD + the `toOrganizerCamp` projection.

**Files:**
- Create: `src/validators/camp.validators.ts`
- Create: `src/services/camp.services.ts`
- Create: `src/controllers/camp.controllers.ts`
- Create: `src/routes/camp.routes.ts` (mounts `/organizer/camps`, `/organizer/summary`, and `/camps/:id`)
- Modify: `src/routes/index.ts` (mount)
- Modify: `src/docs/openapi.ts` (register paths)

**Interfaces:**
- Consumes: `CampModel`, `MembershipModel`, `GroupModel`, `requireCampMember`, `requireCampManager`, `requireAuth`, `requireRole`.
- Produces: `campService.{ listForOrganizer, summary, getOne, create, update, publish, archive, remove }`, `toOrganizerCamp(camp, counts)`. Response type mirrors frontend `OrganizerCamp` / `OrganizerSummary`.

- [ ] **Step 1: Write `camp.validators.ts`**

```ts
import { z } from '../config/zod'

export const campIdParam = z.object({ id: z.string() })

export const createCampSchema = z.object({
  name: z.string().min(1),
  location: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  capacity: z.number().int().nonnegative().optional(),
  languages: z.array(z.enum(['en', 'uz', 'ru'])).optional(),
  coverImage: z.string().url().nullable().optional(),
})

export const updateCampSchema = createCampSchema.partial()
```

- [ ] **Step 2: Write `camp.services.ts` — projection + status derivation first**

```ts
import { CampModel, type Camp } from '../models/camp.model'
import { MembershipModel } from '../models/membership.model'
import { GroupModel } from '../models/group.model'
import { HttpError } from '../middlewares/error.middleware'

export type PublicCampStatus = 'draft' | 'upcoming' | 'active' | 'archived'

function deriveStatus(camp: Camp, now = new Date()): PublicCampStatus {
  if (camp.status === 'draft') return 'draft'
  if (camp.archivedAt) return 'archived'
  if (now < camp.startsAt) return 'upcoming'
  if (now > camp.endsAt) return 'archived'
  return 'active'
}

const MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
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
```

- [ ] **Step 3: Add the service methods to `camp.services.ts`**

```ts
type CreateInput = {
  name: string; location: string; startsAt: string; endsAt: string
  capacity?: number; languages?: string[]; coverImage?: string | null
}

export const campService = {
  // Camps this user runs (organizer memberships) — or all org camps for an org caller.
  listForOrganizer: async (user: { _id: unknown; role: string }) => {
    let camps: Camp[]
    if (user.role === 'organization') {
      camps = await CampModel.find({ organizationId: user._id }).sort({ createdAt: -1 })
    } else {
      const ids = await MembershipModel.find({
        userId: user._id, role: { $ne: 'participant' },
      }).distinct('campId')
      camps = await CampModel.find({ _id: { $in: ids } }).sort({ createdAt: -1 })
    }
    return Promise.all(camps.map(toOrganizerCamp))
  },

  getOne: async (camp: Camp) => toOrganizerCamp(camp), // camp resolved by middleware

  create: async (input: CreateInput, creator: { _id: unknown; role: string; phone?: string }, organizationId: unknown) => {
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
      campId: camp._id, phone: creator.phone ?? `owner:${String(creator._id)}`, userId: creator._id,
      role: 'projectManager', status: 'active',
    })
    return toOrganizerCamp(camp)
  },

  update: async (camp: Camp, patch: Partial<CreateInput>) => {
    Object.assign(camp, patch, {
      ...(patch.startsAt ? { startsAt: new Date(patch.startsAt) } : {}),
      ...(patch.endsAt ? { endsAt: new Date(patch.endsAt) } : {}),
    })
    await (camp as unknown as { save: () => Promise<void> }).save()
    return toOrganizerCamp(camp)
  },

  publish: async (camp: Camp) => {
    camp.status = 'published'
    await (camp as unknown as { save: () => Promise<void> }).save()
    return toOrganizerCamp(camp)
  },

  archive: async (camp: Camp) => {
    camp.archivedAt = new Date()
    await (camp as unknown as { save: () => Promise<void> }).save()
    return toOrganizerCamp(camp)
  },

  remove: async (camp: Camp) => {
    if (camp.status !== 'draft') throw new HttpError(409, 'Only draft camps can be deleted')
    await CampModel.deleteOne({ _id: camp._id })
    await MembershipModel.deleteMany({ campId: camp._id })
  },

  summary: async (user: { _id: unknown; role: string; name: string }) => {
    const camps = await campService.listForOrganizer(user as never)
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
```

Note the `save()` casts are because `InferSchemaType` doesn't include document methods; if the codebase already types documents with `HydratedDocument`, prefer that and drop the casts.

- [ ] **Step 4: Write `camp.controllers.ts` (thin — no try/catch)**

```ts
import type { RequestHandler } from 'express'
import { campService } from '../services/camp.services'

export const listCamps: RequestHandler = async (req, res) => {
  res.json(await campService.listForOrganizer(req.auth!.user as never))
}
export const getCampSummary: RequestHandler = async (req, res) => {
  res.json(await campService.summary(req.auth!.user as never))
}
export const getCamp: RequestHandler = async (req, res) => {
  res.json(await campService.getOne(req.camp!))
}
export const createCamp: RequestHandler = async (req, res) => {
  const user = req.auth!.user as never as { _id: unknown; role: string; organizationId?: unknown }
  const organizationId = user.role === 'organization' ? user._id : (user as { organizationId: unknown }).organizationId
  res.status(201).json(await campService.create(req.body, user as never, organizationId ?? user._id))
}
export const updateCamp: RequestHandler = async (req, res) => {
  res.json(await campService.update(req.camp!, req.body))
}
export const publishCamp: RequestHandler = async (req, res) => {
  res.json(await campService.publish(req.camp!))
}
export const archiveCamp: RequestHandler = async (req, res) => {
  res.json(await campService.archive(req.camp!))
}
export const deleteCamp: RequestHandler = async (req, res) => {
  await campService.remove(req.camp!)
  res.status(204).end()
}
```

Note on `organizationId`: an organizer has no `organizationId` on `User` today. Resolve it from the seed org — if the app has exactly one organization, look it up: `const org = await UserModel.findOne({ role: 'organization' })`. Do this in the service `create` instead of the controller if cleaner. Adjust to however the org linkage is modeled once multi-org exists (single-org for launch).

- [ ] **Step 5: Write `camp.routes.ts`**

```ts
import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth, requireRole } from '../middlewares/auth.middleware'
import { requireCampMember, requireCampManager } from '../middlewares/campScope.middleware'
import { campIdParam, createCampSchema, updateCampSchema } from '../validators/camp.validators'
import * as c from '../controllers/camp.controllers'

// Organizer management projection.
export const organizerCampRouter = Router()
organizerCampRouter.use(requireAuth, requireRole('organizer'))
organizerCampRouter.get('/camps', c.listCamps)
organizerCampRouter.get('/summary', c.getCampSummary)
organizerCampRouter.post('/camps', validate({ body: createCampSchema }), c.createCamp)
organizerCampRouter.get('/camps/:id', validate({ params: campIdParam }), requireCampMember, requireCampManager, c.getCamp)
organizerCampRouter.patch('/camps/:id', validate({ params: campIdParam, body: updateCampSchema }), requireCampMember, requireCampManager, c.updateCamp)
organizerCampRouter.post('/camps/:id/publish', validate({ params: campIdParam }), requireCampMember, requireCampManager, c.publishCamp)
organizerCampRouter.post('/camps/:id/archive', validate({ params: campIdParam }), requireCampMember, requireCampManager, c.archiveCamp)
organizerCampRouter.delete('/camps/:id', validate({ params: campIdParam }), requireCampMember, requireCampManager, c.deleteCamp)

// Shared read projection (participants included).
export const campRouter = Router()
campRouter.get('/:id', requireAuth, validate({ params: campIdParam }), requireCampMember, c.getCamp)
```

- [ ] **Step 6: Mount in `routes/index.ts`**

```ts
import { organizerCampRouter, campRouter } from './camp.routes'
// ...
router.use('/organizer', organizerCampRouter)
router.use('/camps', campRouter)
```

- [ ] **Step 7: Register in `docs/openapi.ts`**

Add a `registry.registerPath(...)` for each of the 8 routes above, reusing `createCampSchema`/`updateCampSchema`/`campIdParam`. Mirror the existing organizer-domain registrations in that file (copy their shape, swap the schemas/paths).

- [ ] **Step 8: Typecheck + manual verify**

Run: `npm run typecheck` → PASS.
Then `npm run dev`, and via `/api/docs` (logged in as an organizer): `POST /organizer/camps` → 201 with an `OrganizerCamp`; `GET /organizer/camps` → the camp appears; `GET /organizer/camps/:id` → the same; `POST .../publish` → status flips to `upcoming`/`active`; `DELETE` a published camp → 409.

- [ ] **Step 9: Commit**

```bash
git add src/validators/camp.validators.ts src/services/camp.services.ts src/controllers/camp.controllers.ts src/routes/camp.routes.ts src/routes/index.ts src/docs/openapi.ts
git commit -m "feat(camps): CRUD + summary endpoints with camp-scoped auth"
```

---

### Task 5: Flip the frontend camps service

**Files:**
- Modify: `Frontend/src/api/services/camps.service.ts`

- [ ] **Step 1: Uncomment the axios calls, delete the mock branch**

In each of `list`/`summary`/`get`, remove the mock return and the `organizerCampsMock` import; enable the commented `axiosInstance` line. Enable the `import { axiosInstance }` at top.

- [ ] **Step 2: Typecheck the frontend**

Run: `cd /Users/mn.afridi/Desktop/Camply/Frontend && npm run typecheck`
Expected: PASS (contract types are unchanged, so the UI compiles as-is).

- [ ] **Step 3: Manual verify end-to-end**

Run both dev servers (`Backend` on :4000, `Frontend` on :5173). Log in as an organizer; the camps dashboard now shows the real (empty or seeded) list from the API, not the mock.

- [ ] **Step 4: Commit (Frontend repo)**

```bash
cd /Users/mn.afridi/Desktop/Camply/Frontend
git add src/api/services/camps.service.ts
git commit -m "feat(camps): point organizer camps service at live API"
```

---

### Task 6: Bind pending memberships on signup/login

When a phone registers or logs in, link its pre-seeded memberships. This is the one touch-point into the existing auth flow — keep it additive and idempotent.

**Files:**
- Modify: `src/services/auth.services.ts` (the register + login paths)
- Create: `src/services/membership.services.ts` (shared membership helpers)

**Interfaces:**
- Produces: `membershipService.bindPhone(userId, phone)`, `membershipService.countParticipantCamps(phone)`.
- Consumes: `MembershipModel`.

- [ ] **Step 1: Write `membership.services.ts`**

```ts
import { MembershipModel } from '../models/membership.model'

export const membershipService = {
  // On signup/login, attach any pending memberships for this phone to the user.
  bindPhone: async (userId: unknown, phone: string): Promise<void> => {
    await MembershipModel.updateMany(
      { phone, userId: null },
      { $set: { userId, status: 'active' } },
    )
  },

  // ≤2-camps rule: how many participant camps this phone already holds.
  countParticipantCamps: async (phone: string): Promise<number> =>
    MembershipModel.countDocuments({ phone, role: 'participant' }),
}
```

- [ ] **Step 2: Call `bindPhone` where a participant session is established**

In `auth.services.ts`, after a participant is created/found on register/login and their `User._id` is known, call `await membershipService.bindPhone(user._id, user.phone)`. Grep for where `/register` and `/login` resolve the user; add the one line in both (or in a shared helper they both call). Do NOT change the response shapes of `/login`, `/register`, `/me`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` → PASS.

- [ ] **Step 4: Manual verify**

Seed a membership manually (`db.memberships.insertOne({ campId, phone: '+998...', role: 'participant', status: 'pending', userId: null, checkin: 'out' })`), then register/login that phone; confirm the membership now has `userId` set and `status: 'active'`.

- [ ] **Step 5: Commit**

```bash
git add src/services/membership.services.ts src/services/auth.services.ts
git commit -m "feat(auth): bind pending camp memberships on phone signup"
```

---

### Task 7: Roster domain (add-by-phone, ≤2 enforcement, check-in)

**Files:**
- Create: `src/validators/roster.validators.ts`
- Create: `src/services/roster.services.ts`
- Create: `src/controllers/roster.controllers.ts`
- Create: `src/routes/roster.routes.ts` (mounted under organizer camps)
- Modify: `src/routes/camp.routes.ts` or `index.ts` to mount roster under `/organizer/camps/:id/roster`
- Modify: `src/docs/openapi.ts`

**Interfaces:**
- Consumes: `MembershipModel`, `UserModel`, `GroupModel`, `membershipService.countParticipantCamps`, `requireCampMember`, `requireCampManager`.
- Produces: `rosterService.{ list, add, update, setCheckin, remove }`, `toRosterParticipant(membership)` (resolves user/group internally) → frontend `RosterParticipant`; and the shared `src/utils/avatar.ts` (`initialsOf`, `colorFor`) reused by groups + announcements.

- [ ] **Step 1: Write the shared `src/utils/avatar.ts`** (reused by roster, groups, announcements — extract once, DRY)

```ts
// Display-only identity helpers. No stored fields: initials come from the name,
// the tile color is a deterministic pick so a person keeps one color.
const PALETTE = ['pine', 'amber', 'sky', 'deep']

export const initialsOf = (name: string): string =>
  name.split(' ').map((p) => p[0]?.toUpperCase() ?? '').slice(0, 2).join('')

export const colorFor = (seed: string): string =>
  PALETTE[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length]
```

- [ ] **Step 2: Write `roster.validators.ts`**

```ts
import { z } from '../config/zod'

export const rosterIdParams = z.object({ id: z.string(), mid: z.string() })
export const addRosterSchema = z.object({
  phone: z.string().min(5),
  groupId: z.string().nullable().optional(),
})
export const updateRosterSchema = z.object({
  groupId: z.string().nullable().optional(),
  role: z.string().optional(),
})
export const checkinSchema = z.object({ status: z.enum(['in', 'out']) })
```

- [ ] **Step 3: Write `roster.services.ts` with the projection + ≤2 guard**

```ts
import { MembershipModel, type Membership } from '../models/membership.model'
import { UserModel } from '../models/user.model'
import { GroupModel } from '../models/group.model'
import { membershipService } from './membership.services'
import { initialsOf, colorFor } from '../utils/avatar'
import { HttpError } from '../middlewares/error.middleware'

export async function toRosterParticipant(m: Membership) {
  const [user, group] = await Promise.all([
    m.userId ? UserModel.findById(m.userId) : null,
    m.groupId ? GroupModel.findById(m.groupId) : null,
  ])
  const name = user ? `${user.name} ${user.surname}`.trim() : ''
  return {
    id: String(m._id),
    name,
    initials: initialsOf(name || m.phone),
    avatarColor: colorFor(String(m._id)),
    photo: user?.photo ?? null,
    groupId: group ? String(group._id) : null,
    groupName: group?.name ?? null,
    city: user?.cityId ?? '',
    age: user?.age ?? 0,
    status: m.checkin, // 'in' | 'out'
    phone: m.phone,
  }
}

export const rosterService = {
  list: async (campId: unknown) => {
    const members = await MembershipModel.find({ campId, role: 'participant' })
    const rows = await Promise.all(members.map(toRosterParticipant))
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  },

  add: async (campId: unknown, phone: string, groupId?: string | null) => {
    if ((await membershipService.countParticipantCamps(phone)) >= 2) {
      throw new HttpError(409, 'This phone is already in 2 camps')
    }
    const existingUser = await UserModel.findOne({ phone })
    const m = await MembershipModel.create({
      campId, phone, groupId: groupId ?? null, role: 'participant',
      userId: existingUser?._id ?? null,
      status: existingUser ? 'active' : 'pending',
    })
    return toRosterParticipant(m)
  },

  update: async (mid: string, patch: { groupId?: string | null; role?: string }) => {
    const m = await MembershipModel.findByIdAndUpdate(mid, { $set: patch }, { new: true })
    if (!m) throw new HttpError(404, 'Membership not found')
    return toRosterParticipant(m)
  },

  setCheckin: async (mid: string, status: 'in' | 'out') => {
    const m = await MembershipModel.findByIdAndUpdate(mid, { $set: { checkin: status } }, { new: true })
    if (!m) throw new HttpError(404, 'Membership not found')
    return toRosterParticipant(m)
  },

  remove: async (mid: string) => {
    const res = await MembershipModel.deleteOne({ _id: mid })
    if (res.deletedCount === 0) throw new HttpError(404, 'Membership not found')
  },
}
```

- [ ] **Step 4: Write `roster.controllers.ts`** — thin handlers mirroring Task 4 Step 4: `listRoster` (`rosterService.list(req.camp!._id)`), `addRoster` (`req.body.phone`, `req.body.groupId`), `updateRoster` (`req.params.mid`, `req.body`), `setCheckin` (`req.params.mid`, `req.body.status`), `removeRoster` (`req.params.mid` → 204). No try/catch.

- [ ] **Step 5: Write `roster.routes.ts`** — a `Router({ mergeParams: true })` so `:id` is visible, all routes `requireAuth, requireCampMember, requireCampManager`:

```ts
import { Router } from 'express'
import { validate } from '../middlewares/validate.middleware'
import { requireAuth } from '../middlewares/auth.middleware'
import { requireCampMember, requireCampManager } from '../middlewares/campScope.middleware'
import { rosterIdParams, addRosterSchema, updateRosterSchema, checkinSchema } from '../validators/roster.validators'
import { campIdParam } from '../validators/camp.validators'
import * as c from '../controllers/roster.controllers'

const router = Router({ mergeParams: true })
router.use(requireAuth, requireCampMember, requireCampManager)
router.get('/', c.listRoster)
router.post('/', validate({ params: campIdParam, body: addRosterSchema }), c.addRoster)
router.patch('/:mid', validate({ params: rosterIdParams, body: updateRosterSchema }), c.updateRoster)
router.patch('/:mid/checkin', validate({ params: rosterIdParams, body: checkinSchema }), c.setCheckin)
router.delete('/:mid', validate({ params: rosterIdParams }), c.removeRoster)
export default router
```

Mount it: in `camp.routes.ts`, `organizerCampRouter.use('/camps/:id/roster', rosterRouter)`. Because `requireCampMember` reads `req.params.id`, `mergeParams: true` is required.

- [ ] **Step 6: OpenAPI + typecheck + verify + commit**

Register the 5 roster paths in `openapi.ts`. `npm run typecheck` → PASS. Verify: `POST /organizer/camps/:id/roster {phone}` → 201 pending row; add the same phone to a 3rd camp → 409; `PATCH .../:mid/checkin {status:'in'}` → row status flips; `GET` roster → sorted rows.
```bash
git add src/utils/avatar.ts src/validators/roster.validators.ts src/services/roster.services.ts src/controllers/roster.controllers.ts src/routes/roster.routes.ts src/routes/camp.routes.ts src/docs/openapi.ts
git commit -m "feat(roster): add-by-phone, group assign, check-in, remove"
```

---

### Task 8: Flip the frontend roster service

**Files:** Modify `Frontend/src/api/services/roster.service.ts`

- [ ] **Step 1:** In `list`, remove the `rosterMock`/`CAMP_GROUPS` mock branch and imports; enable `axiosInstance.get<RosterParticipant[]>(`/organizer/camps/${campId}/roster`)`. (Add/uncomment `axiosInstance` import.)
- [ ] **Step 2:** `cd Frontend && npm run typecheck` → PASS.
- [ ] **Step 3:** Verify the organizer Participants tab shows live rows.
- [ ] **Step 4:** Commit in Frontend repo: `feat(roster): point roster service at live API`.

---

### Task 9: Groups domain

**Files:** `src/validators/group.validators.ts`, `src/services/group.services.ts`, `src/controllers/group.controllers.ts`, `src/routes/group.routes.ts`; modify `camp.routes.ts` + `openapi.ts`.

**Interfaces:** Produces `groupService.{ list, create, update, remove }`, `toCampGroupDetail(group)` (resolves members internally) → frontend `CampGroupDetail`.

- [ ] **Step 1: Validators**

```ts
import { z } from '../config/zod'
export const groupIdParams = z.object({ id: z.string(), gid: z.string() })
export const createGroupSchema = z.object({ name: z.string().min(1), color: z.string().min(1) })
export const updateGroupSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  leaderMembershipId: z.string().nullable().optional(),
})
```

- [ ] **Step 2: Service + projection**

```ts
import { GroupModel, type Group } from '../models/group.model'
import { MembershipModel } from '../models/membership.model'
import { UserModel } from '../models/user.model'
import { initialsOf, colorFor } from '../utils/avatar'
import { HttpError } from '../middlewares/error.middleware'

export async function toCampGroupDetail(group: Group) {
  const memberships = await MembershipModel.find({ groupId: group._id, role: 'participant' })
  const members = await Promise.all(
    memberships.map(async (m) => {
      const user = m.userId ? await UserModel.findById(m.userId) : null
      const name = user ? `${user.name} ${user.surname}`.trim() : m.phone
      return {
        id: String(m._id),
        name,
        initials: initialsOf(name),
        avatarColor: colorFor(String(m._id)),
        photo: user?.photo ?? null,
        isLeader: String(group.leaderMembershipId ?? '') === String(m._id),
      }
    }),
  )
  const leader = members.find((x) => x.isLeader)
  return {
    id: String(group._id),
    name: group.name,
    color: group.color,
    memberCount: members.length,
    leaderName: leader?.name ?? null,
    members,
  }
}

export const groupService = {
  list: async (campId: unknown) => {
    const groups = await GroupModel.find({ campId }).sort({ createdAt: 1 })
    return Promise.all(groups.map(toCampGroupDetail))
  },
  create: async (campId: unknown, input: { name: string; color: string }) =>
    toCampGroupDetail(await GroupModel.create({ campId, ...input })),
  update: async (gid: string, patch: Record<string, unknown>) => {
    const g = await GroupModel.findByIdAndUpdate(gid, { $set: patch }, { new: true })
    if (!g) throw new HttpError(404, 'Group not found')
    return toCampGroupDetail(g)
  },
  remove: async (gid: string) => {
    await MembershipModel.updateMany({ groupId: gid }, { $set: { groupId: null } })
    const res = await GroupModel.deleteOne({ _id: gid })
    if (res.deletedCount === 0) throw new HttpError(404, 'Group not found')
  },
}
```

- [ ] **Step 3: Controllers** — thin: `listGroups`, `createGroup`, `updateGroup` (`req.params.gid`), `removeGroup` (→204). Mirror Task 4 Step 4.
- [ ] **Step 4: Routes** — `Router({ mergeParams: true })`, `requireAuth, requireCampMember, requireCampManager`; `GET /`, `POST /`, `PATCH /:gid`, `DELETE /:gid`. Mount `organizerCampRouter.use('/camps/:id/groups', groupRouter)`.
- [ ] **Step 5:** OpenAPI + `npm run typecheck` → PASS. Verify create/list/rename/delete. Commit `feat(groups): CRUD with member+leader projection`.

---

### Task 10: Flip the frontend campGroups service

**Files:** Modify `Frontend/src/api/services/campGroups.service.ts`

- [ ] **Step 1:** Replace the derived-from-`rosterMock` body with `axiosInstance.get<CampGroupDetail[]>(`/organizer/camps/${campId}/groups`)`; drop `rosterMock`/`CAMP_GROUPS` imports.
- [ ] **Step 2:** `npm run typecheck` (Frontend) → PASS. **Step 3:** verify Groups tab. **Step 4:** commit.

---

### Task 11: Schedule domain

**Files:** `src/validators/schedule.validators.ts`, `src/services/schedule.services.ts`, `src/controllers/schedule.controllers.ts`, `src/routes/schedule.routes.ts`; modify `camp.routes.ts` + `openapi.ts`.

**Interfaces:** Produces `scheduleService.{ list, create, update, remove }`, `toActivity(doc)` (resolves group name internally) → frontend `Activity`.

- [ ] **Step 1: Validators**

```ts
import { z } from '../config/zod'
export const activityIdParams = z.object({ id: z.string(), aid: z.string() })
const scopeSchema = z.union([
  z.object({ kind: z.literal('camp') }),
  z.object({ kind: z.literal('group'), groupId: z.string(), groupName: z.string() }),
])
export const createActivitySchema = z.object({
  campId: z.string(),
  title: z.string().min(1),
  location: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  scope: scopeSchema,
  description: z.string().nullable().optional(),
})
export const updateActivitySchema = createActivitySchema.partial()
```

- [ ] **Step 2: Service + projection** — `toActivity` returns the frontend `Activity` shape: `{ id, campId, title, location, startsAt (ISO), endsAt (ISO), scope, description }`. `scope` is `{ kind: 'camp' }` or `{ kind: 'group', groupId, groupName }` — resolve `groupName` from `GroupModel` when `scope === 'group'`.

```ts
import { ActivityModel, type Activity as ActivityDoc } from '../models/activity.model'
import { GroupModel } from '../models/group.model'
import { HttpError } from '../middlewares/error.middleware'

async function toActivity(a: ActivityDoc) {
  let scope: { kind: 'camp' } | { kind: 'group'; groupId: string; groupName: string } = { kind: 'camp' }
  if (a.scope === 'group' && a.groupId) {
    const g = await GroupModel.findById(a.groupId)
    scope = { kind: 'group', groupId: String(a.groupId), groupName: g?.name ?? '' }
  }
  return {
    id: String(a._id),
    campId: String(a.campId),
    title: a.title,
    location: a.location,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    scope,
    description: a.description ?? null,
  }
}

type NewActivity = {
  campId: string; title: string; location: string; startsAt: string; endsAt: string
  scope: { kind: 'camp' } | { kind: 'group'; groupId: string; groupName: string }
  description?: string | null
}

export const scheduleService = {
  list: async (campId: unknown) => {
    const items = await ActivityModel.find({ campId }).sort({ startsAt: 1 })
    return Promise.all(items.map(toActivity))
  },
  create: async (campId: unknown, input: NewActivity) => {
    const doc = await ActivityModel.create({
      campId,
      title: input.title,
      location: input.location,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      scope: input.scope.kind,
      groupId: input.scope.kind === 'group' ? input.scope.groupId : null,
      description: input.description ?? null,
    })
    return toActivity(doc)
  },
  update: async (aid: string, patch: Partial<NewActivity>) => {
    const set: Record<string, unknown> = { ...patch }
    if (patch.startsAt) set.startsAt = new Date(patch.startsAt)
    if (patch.endsAt) set.endsAt = new Date(patch.endsAt)
    if (patch.scope) { set.scope = patch.scope.kind; set.groupId = patch.scope.kind === 'group' ? patch.scope.groupId : null }
    const doc = await ActivityModel.findByIdAndUpdate(aid, { $set: set }, { new: true })
    if (!doc) throw new HttpError(404, 'Activity not found')
    return toActivity(doc)
  },
  remove: async (aid: string) => {
    const res = await ActivityModel.deleteOne({ _id: aid })
    if (res.deletedCount === 0) throw new HttpError(404, 'Activity not found')
  },
}
```

- [ ] **Step 3: Controllers** — `listSchedule` (`req.camp!._id`), `createActivity` (`req.camp!._id`, `req.body`), `updateActivity` (`req.params.aid`), `deleteActivity` (→204).
- [ ] **Step 4: Routes** — mounted at `/camps/:id/schedule`. `GET /` uses `requireCampMember` only (participants read). `POST/PATCH/DELETE` add `requireCampManager`. `Router({ mergeParams: true })`. Mount on the shared `campRouter`: `campRouter.use('/:id/schedule', scheduleRouter)`.
- [ ] **Step 5:** OpenAPI + typecheck → PASS. Verify create/list/edit/delete; confirm a participant of the camp can GET but not POST. Commit `feat(schedule): activity CRUD, member-read/manager-write`.

---

### Task 12: Flip the frontend schedule service

**Files:** Modify `Frontend/src/api/services/schedule.service.ts`

- [ ] **Step 1:** `list` → `axiosInstance.get<Activity[]>(`/camps/${campId}/schedule`)`; `create` → `axiosInstance.post<Activity>(`/camps/${activity.campId}/schedule`, activity)`. Drop `scheduleMock` import + mutation. Keep the pure helpers (`groupIntoDays`, `pickToday`, etc.) untouched.
- [ ] **Step 2:** Frontend typecheck → PASS. **Step 3:** verify participant schedule screen + organizer compose. **Step 4:** commit.

---

### Task 13: Announcements domain

**Files:** `src/validators/announcement.validators.ts`, `src/services/announcement.services.ts`, `src/controllers/announcement.controllers.ts`, `src/routes/announcement.routes.ts`; modify `camp.routes.ts` + `openapi.ts`.

**Interfaces:** Produces `announcementService.{ list, getById, create, update, setPinned, remove }`, `toAnnouncement(doc)` (resolves author + group internally) → frontend `Announcement`.

- [ ] **Step 1: Validators**

```ts
import { z } from '../config/zod'
export const announcementIdParams = z.object({ id: z.string(), aid: z.string() })
const scopeSchema = z.union([
  z.object({ kind: z.literal('camp') }),
  z.object({ kind: z.literal('group'), groupId: z.string(), groupName: z.string() }),
])
export const createAnnouncementSchema = z.object({
  campId: z.string(),
  title: z.string().optional(),
  body: z.string().min(1),
  scope: scopeSchema,
  pinned: z.boolean().optional(),
})
export const updateAnnouncementSchema = z.object({
  title: z.string().nullable().optional(),
  body: z.string().min(1).optional(),
})
export const pinSchema = z.object({ pinned: z.boolean() })
```

- [ ] **Step 2: Service + projection** — `toAnnouncement` returns `{ id, campId, title?, body, scope, author, pinned, createdAt (ISO), updatedAt? }`. `author` is `{ id, name, role: 'organizer'|'organization', avatarColor, photo }` joined from `UserModel` by `authorId`. List sorted pinned-first then `createdAt` desc.

```ts
import { AnnouncementModel, type Announcement as Doc } from '../models/announcement.model'
import { UserModel } from '../models/user.model'
import { GroupModel } from '../models/group.model'
import { colorFor } from '../utils/avatar'
import { HttpError } from '../middlewares/error.middleware'

async function toAnnouncement(a: Doc) {
  const author = await UserModel.findById(a.authorId)
  let scope: { kind: 'camp' } | { kind: 'group'; groupId: string; groupName: string } = { kind: 'camp' }
  if (a.scope === 'group' && a.groupId) {
    const g = await GroupModel.findById(a.groupId)
    scope = { kind: 'group', groupId: String(a.groupId), groupName: g?.name ?? '' }
  }
  return {
    id: String(a._id),
    campId: String(a.campId),
    title: a.title ?? undefined,
    body: a.body,
    scope,
    author: {
      id: String(a.authorId),
      name: author ? `${author.name} ${author.surname}`.trim() : '',
      role: (author?.role === 'organization' ? 'organization' : 'organizer') as 'organizer' | 'organization',
      avatarColor: colorFor(String(a.authorId)),
      photo: author?.photo ?? null,
    },
    pinned: a.pinned,
    createdAt: (a as unknown as { createdAt: Date }).createdAt.toISOString(),
    updatedAt: (a as unknown as { updatedAt: Date }).updatedAt?.toISOString(),
  }
}

export const announcementService = {
  list: async (campId: unknown) => {
    const items = await AnnouncementModel.find({ campId }).sort({ pinned: -1, createdAt: -1 })
    return Promise.all(items.map(toAnnouncement))
  },
  getById: async (aid: string) => {
    const a = await AnnouncementModel.findById(aid)
    if (!a) throw new HttpError(404, 'Announcement not found')
    return toAnnouncement(a)
  },
  create: async (campId: unknown, authorId: unknown, input: { title?: string; body: string; scope: { kind: 'camp' } | { kind: 'group'; groupId: string }; pinned?: boolean }) => {
    const doc = await AnnouncementModel.create({
      campId, authorId, title: input.title ?? null, body: input.body,
      scope: input.scope.kind, groupId: input.scope.kind === 'group' ? input.scope.groupId : null,
      pinned: input.pinned ?? false,
    })
    return toAnnouncement(doc)
  },
  update: async (aid: string, patch: { title?: string | null; body?: string }) => {
    const doc = await AnnouncementModel.findByIdAndUpdate(aid, { $set: patch }, { new: true })
    if (!doc) throw new HttpError(404, 'Announcement not found')
    return toAnnouncement(doc)
  },
  setPinned: async (aid: string, pinned: boolean) => {
    const doc = await AnnouncementModel.findByIdAndUpdate(aid, { $set: { pinned } }, { new: true })
    if (!doc) throw new HttpError(404, 'Announcement not found')
    return toAnnouncement(doc)
  },
  remove: async (aid: string) => {
    const res = await AnnouncementModel.deleteOne({ _id: aid })
    if (res.deletedCount === 0) throw new HttpError(404, 'Announcement not found')
  },
}
```

- [ ] **Step 3: Controllers** — `listAnnouncements`, `getAnnouncement` (`req.params.aid`), `createAnnouncement` (`req.camp!._id`, `req.auth!.user._id`, `req.body`), `updateAnnouncement`, `pinAnnouncement` (`req.body.pinned`), `deleteAnnouncement` (→204).
- [ ] **Step 4: Routes** — `/camps/:id/announcements`. `GET /` and `GET /:aid` use `requireCampMember`; `POST/PATCH/DELETE` add `requireCampManager`. `Router({ mergeParams: true })`, mount on `campRouter`.
- [ ] **Step 5:** OpenAPI + typecheck → PASS. Verify post/list (pinned-first)/pin toggle/edit/delete; participant can read. Commit `feat(announcements): CRUD + pin, member-read/manager-write`.

---

### Task 14: Flip the frontend announcements service

**Files:** Modify `Frontend/src/api/services/announcements.service.ts`

- [ ] **Step 1:** `list` / `getById` / `create` → enable the axios lines; drop `announcementsMock`. Keep `CURRENT_CAMP_ID` export (still referenced) but callers now pass a real `campId` from camp context. **Step 2:** typecheck. **Step 3:** verify feed + compose. **Step 4:** commit.

---

### Task 15: Leaderboard domain

**Files:** `src/validators/leaderboard.validators.ts`, `src/services/leaderboard.services.ts`, `src/controllers/leaderboard.controllers.ts`, `src/routes/leaderboard.routes.ts`; modify `camp.routes.ts`, `group.services.ts` (seed a `GroupPoints` row on group create), `openapi.ts`.

**Interfaces:** Produces `leaderboardService.{ get, adjust }`, `toLeaderboard(pointsRows, groups, callerGroupId)` → frontend `Leaderboard` (`{ periodLabel, groups: LeaderboardGroup[], currentGroupId }`).

- [ ] **Step 1: Validators**

```ts
import { z } from '../config/zod'
export const leaderboardParams = z.object({ id: z.string(), gid: z.string() })
export const adjustPointsSchema = z.object({
  delta: z.number().int(),
  category: z.enum(['activities', 'attendance', 'challenges']),
})
```

- [ ] **Step 2: Seed a `GroupPoints` row when a group is created.** In `group.services.ts` `create`, after `GroupModel.create`, add `await GroupPointsModel.create({ campId, groupId: group._id })`. Import `GroupPointsModel`. (And delete the row in `group.services.remove`.)

- [ ] **Step 3: Service + projection**

```ts
import { GroupPointsModel, PointEventModel, type GroupPoints } from '../models/leaderboard.model'
import { GroupModel } from '../models/group.model'
import { MembershipModel } from '../models/membership.model'
import { HttpError } from '../middlewares/error.middleware'

export const leaderboardService = {
  get: async (campId: unknown, callerUserId: unknown) => {
    const [rows, groups] = await Promise.all([
      GroupPointsModel.find({ campId }),
      GroupModel.find({ campId }),
    ])
    const byGroup = new Map(rows.map((r) => [String(r.groupId), r]))
    const callerMembership = await MembershipModel.findOne({ campId, userId: callerUserId })
    const currentGroupId = callerMembership?.groupId ? String(callerMembership.groupId) : null

    return {
      periodLabel: 'Week 1', // period selector is a later feature; label is contract-required
      currentGroupId,
      groups: groups.map((g) => {
        const p = byGroup.get(String(g._id))
        const activities = p?.activities ?? 0
        const attendance = p?.attendance ?? 0
        const challenges = p?.challenges ?? 0
        return {
          id: String(g._id),
          name: g.name,
          color: g.color,
          photo: g.photo ?? undefined,
          score: activities + attendance + challenges,
          previousScore: p?.previousScore ?? 0,
          breakdown: { activities, attendance, challenges },
        }
      }),
    }
  },

  adjust: async (campId: unknown, gid: string, delta: number, category: 'activities' | 'attendance' | 'challenges', byUserId: unknown) => {
    const row = await GroupPointsModel.findOne({ campId, groupId: gid })
    if (!row) throw new HttpError(404, 'Group has no leaderboard row')
    await GroupPointsModel.updateOne({ _id: row._id }, { $inc: { [category]: delta } })
    await PointEventModel.create({ campId, groupId: gid, category, delta, byUserId })
  },
}
```

- [ ] **Step 4: Controllers** — `getLeaderboard` (`req.camp!._id`, `req.auth!.user._id`), `adjustPoints` (`req.camp!._id`, `req.params.gid`, `req.body.delta`, `req.body.category`, `req.auth!.user._id` → 204 or the refreshed leaderboard).
- [ ] **Step 5: Routes** — `/camps/:id/leaderboard`. `GET /` `requireCampMember`; `POST /:gid/points` adds `requireCampManager`. `mergeParams: true`, mount on `campRouter`.
- [ ] **Step 6:** OpenAPI + typecheck → PASS. Verify GET standings, POST adjust changes a category total + writes a PointEvent. Commit `feat(leaderboard): standings read + point adjust with audit`.

---

### Task 16: Migrate frontend leaderboard from `lib/` → `api/`

Per Frontend CLAUDE.md, `lib/leaderboard.ts` migrates into the `api/services` + `api/queries` pair as its endpoint lands.

**Files:**
- Create: `Frontend/src/api/services/leaderboard.service.ts`
- Create: `Frontend/src/api/queries/leaderboard.queries.ts`
- Modify: `Frontend/src/api/queryKeys.ts` (add `leaderboardKeys` under `campKeys`)
- Modify: `lib/leaderboard.ts` (keep the pure `deriveLeaderboard`/types; remove the fetch hook + mock) OR re-export from the new module
- Modify: consumers `useLeaderboard`/`useAdjustGroupPoints` imports (`components/participant/ranks/*`, `components/organizer/detail/leaderboard/*`)

- [ ] **Step 1: Create `leaderboard.service.ts`** — export the `Leaderboard`/`LeaderboardGroup`/`LeaderboardBreakdown` types (move from `lib/leaderboard.ts`) and:

```ts
import { axiosInstance } from '../axiosInstance'
export const leaderboardService = {
  get: async (campId: string): Promise<Leaderboard> =>
    (await axiosInstance.get<Leaderboard>(`/camps/${campId}/leaderboard`)).data,
  adjust: async (campId: string, groupId: string, delta: number, category: 'activities'|'attendance'|'challenges'): Promise<void> => {
    await axiosInstance.post(`/camps/${campId}/leaderboard/${groupId}/points`, { delta, category })
  },
}
```

- [ ] **Step 2: Create `leaderboard.queries.ts`** — `useLeaderboard(campId)` (`useQuery`, keyed `leaderboardKeys`) and `useAdjustGroupPoints(campId)` (`useMutation` → `invalidateQueries({ queryKey: leaderboardKeys(campId) })`). Preserve the existing hook names/signatures the components call (`LeaderboardTab` calls `useAdjustGroupPoints().mutate({ groupId, delta })` — keep that shape; add `category` with a default of `'activities'` if the UI doesn't pick one yet).
- [ ] **Step 3:** Keep `deriveLeaderboard()` + view-model types in `lib/leaderboard.ts` (pure, still used). Update consumers to import the hooks from `api/queries/leaderboard.queries`.
- [ ] **Step 4:** `cd Frontend && npm run typecheck` → PASS. Verify participant ranks screen + organizer leaderboard tab (award points → total updates). Commit `refactor(leaderboard): migrate lib → api service/query, live endpoint`.

---

### Task 17: Team domain (organizer sub-roles, reuses Invite)

**Files:** `src/validators/team.validators.ts`, `src/services/team.services.ts`, `src/controllers/team.controllers.ts`, `src/routes/team.routes.ts`; modify `routes/index.ts` (mount `/organizer/team`) + `openapi.ts`. Reuse `models/invite.model.ts`, `services/invite.services.ts`, `services/mailer.service.ts`.

**Interfaces:** Produces `teamService.{ list, invite, cancelInvite }` → frontend `Team` (`{ organizationName, members, pending }`).

- [ ] **Step 1: Validators**

```ts
import { z } from '../config/zod'
const ROLE = z.enum(['projectManager','coordinator','admin','media','brandFace','eventManager','photographer'])
export const inviteTeamSchema = z.object({ phone: z.string().min(5), role: ROLE })
export const teamInviteIdParam = z.object({ id: z.string() })
```

- [ ] **Step 2: Service** — `list()` returns the caller's team: `members` = organizer-tier memberships across the caller's camps mapped to `TeamMember { id, name, initials, avatarColor, photo, role, isMe }`; `pending` = outstanding team invites mapped to `PendingInvite { id, phone (display-formatted), role, sentAt }`. `invite({ phone, role })` creates a pending organizer-tier membership (or an `Invite`, mirroring the org→organizer flow) — **guardrail: role must be one of the 7 sub-roles, never a peer `organizer`/`organization`.** `cancelInvite(id)` removes it. Reuse `inviteService`/`mailerService` for the notification exactly as `organizer.services.ts` does.

  Keep this slice minimal: if full team modeling is unclear, back `members`/`pending` with the organizer-tier `Membership` rows you already have (`status: 'pending'` = pending invite, `active` = member) rather than introducing a new collection.

- [ ] **Step 3: Controllers + routes** — `getTeam`, `inviteTeammate`, `cancelTeamInvite`. Router `requireAuth, requireRole('organizer')`; `GET /`, `POST /invites`, `DELETE /invites/:id`. Mount `router.use('/organizer/team', teamRouter)` in `index.ts` (after the organizer camp router; ensure no path collision — `/organizer/team` vs `/organizer/camps` are distinct).
- [ ] **Step 4:** OpenAPI + typecheck → PASS. Verify list/invite/cancel; confirm a `role: 'organizer'` in the body is rejected. Commit `feat(team): organizer sub-role invites (reuses Invite)`.

---

### Task 18: Flip the frontend team service + final sweep

**Files:** Modify `Frontend/src/api/services/team.service.ts`; then a repo-wide verification.

- [ ] **Step 1:** `list`/`invite`/`cancelInvite` → enable the axios lines, drop `teamMock`.
- [ ] **Step 2:** `cd Frontend && npm run typecheck` → PASS. Verify the organizer Team screen.
- [ ] **Step 3: Backend final gate** — `cd Backend && npm run validate` (lint + format:check + typecheck) → PASS. Format any touched files: `npx prettier --write --end-of-line auto src/**/*.ts` (touched files only).
- [ ] **Step 4: Update Backend CLAUDE.md** — add a short section documenting the new domains (camp/group/membership/activity/announcement/leaderboard/team), the `campScope.middleware` (member vs manager), and the phone-based membership-binding touch-point in auth. This is part of the task, not an afterthought.
- [ ] **Step 5: Commit** both repos: Frontend `feat(team): point team service at live API`; Backend `docs: document organizer CRUD domains + camp-scoping in CLAUDE.md`.

---

## Notes for the executor

- **Mongoose document typing:** `InferSchemaType` gives the *data* shape, not the hydrated document (no `.save()`/`._id` typing). If the existing models expose a `HydratedDocument` alias, use it and drop the `as unknown as { save }` casts shown above. Keep it consistent with `user.model.ts`.
- **`req.auth!.user._id`:** the auth augmentation types `user` as the Mongoose `User`. If `_id` types as `unknown`, wrap in `String(...)` (already done in the samples) — never compare ObjectIds with `===` directly.
- **`mergeParams: true`** is mandatory on every sub-router mounted under `/camps/:id/...` or `/organizer/camps/:id/...`, or `requireCampMember` won't see `req.params.id`.
- **Frontend commits go in the Frontend repo, backend commits in the Backend repo** (two separate git repos; root is not one).
- **Single-org assumption:** `organizationId` resolves from the one seeded organization for launch. When multi-org lands, thread the org id through organizer creation instead.
