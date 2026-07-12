import type { Types } from 'mongoose'
import { AnnouncementModel, type Announcement as Doc } from '../models/announcement.model'
import { UserModel } from '../models/user.model'
import { GroupModel } from '../models/group.model'
import { colorFor } from '../utils/avatar'
import { HttpError } from '../middlewares/error.middleware'

type Scope = { kind: 'camp' } | { kind: 'group'; groupId: string; groupName: string }

async function toAnnouncement(a: Doc) {
  const author = await UserModel.findById(a.authorId)
  let scope: Scope = { kind: 'camp' }
  if (a.scope === 'group' && a.groupId) {
    const g = await GroupModel.findById(a.groupId)
    scope = { kind: 'group', groupId: String(a.groupId), groupName: g?.name ?? '' }
  }
  const ts = a as unknown as { createdAt: Date; updatedAt?: Date }
  return {
    id: String(a._id),
    campId: String(a.campId),
    title: a.title ?? undefined,
    body: a.body,
    scope,
    author: {
      id: String(a.authorId),
      name: author ? `${author.name} ${author.surname}`.trim() : '',
      role: (author?.role === 'organization' ? 'organization' : 'organizer') as
        'organizer' | 'organization',
      avatarColor: colorFor(String(a.authorId)),
      photo: author?.photo ?? null,
    },
    pinned: a.pinned,
    createdAt: ts.createdAt.toISOString(),
    updatedAt: ts.updatedAt?.toISOString(),
  }
}

export const announcementService = {
  list: async (campId: Types.ObjectId) => {
    const items = await AnnouncementModel.find({ campId }).sort({ pinned: -1, createdAt: -1 })
    return Promise.all(items.map(toAnnouncement))
  },
  getById: async (aid: string) => {
    const a = await AnnouncementModel.findById(aid)
    if (!a) throw new HttpError(404, 'Announcement not found')
    return toAnnouncement(a)
  },
  create: async (
    campId: Types.ObjectId,
    authorId: Types.ObjectId,
    input: { title?: string; body: string; scope: Scope; pinned?: boolean },
  ) => {
    const doc = await AnnouncementModel.create({
      campId,
      authorId,
      title: input.title ?? null,
      body: input.body,
      scope: input.scope.kind,
      groupId: input.scope.kind === 'group' ? input.scope.groupId : null,
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
