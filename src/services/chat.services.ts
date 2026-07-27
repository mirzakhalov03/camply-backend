import { Types } from 'mongoose'
import { MessageModel, type Message, type MessageChannel } from '../models/message.model'
import { MembershipModel, ORGANIZER_SUB_ROLES } from '../models/membership.model'
import { UserModel } from '../models/user.model'
import { initialsOf, colorFor } from '../utils/avatar'
import { chatReadService } from './chatRead.services'

export const HISTORY_LIMIT = 50

// The frontend ChatMessage contract (lib/chat.ts). Text-only server-side: kind is
// always 'text'; sentByMe/status are resolved client-side. reactions are aggregated
// per viewer (mine is against viewerId).
export type MessageReaction = { emoji: string; count: number; mine: boolean }

// Denormalized snapshot of a replied-to message (viewer-neutral, deletion-proof).
export type ReplySnapshot = { messageId: string; authorName: string; text: string }

export type ChatMessage = {
  id: string
  authorId: string
  kind: 'text'
  text: string
  time: string // HH:MM
  createdAt: string // ISO — the client can re-derive `time` and ordering
  reactions: MessageReaction[]
  replyTo?: ReplySnapshot
}

export type ChatMember = {
  id: string
  name: string
  initials: string
  color: string
  photo?: string | null
  role: string
}

const hhmm = (d: Date): string => d.toTimeString().slice(0, 5)

const REPLY_SNIPPET_MAX = 120
const snippet = (s: string) =>
  s.length > REPLY_SNIPPET_MAX ? `${s.slice(0, REPLY_SNIPPET_MAX)}…` : s

// Accepts a hydrated document OR a .lean() plain object — `history` reads lean,
// `postMessage` passes the freshly created document. `createdAt` comes from
// `timestamps: true`, which InferSchemaType doesn't surface, hence the explicit field.
type MessageLike = Message & { createdAt?: Date }

function toChatMessage(doc: MessageLike, viewerId?: string): ChatMessage {
  const createdAt = doc.createdAt as Date
  return {
    id: String(doc._id),
    authorId: String(doc.authorId),
    kind: 'text',
    text: doc.text,
    time: hhmm(createdAt),
    createdAt: createdAt.toISOString(),
    reactions: aggregateReactions(doc.reactions ?? [], viewerId),
    replyTo: doc.replyTo
      ? {
          messageId: String(doc.replyTo.messageId),
          authorName: doc.replyTo.authorName,
          text: doc.replyTo.text,
        }
      : undefined,
  }
}

// Group the flat {userId, emoji} pairs into { emoji, count, mine } chips.
function aggregateReactions(
  raw: { userId: unknown; emoji: string }[],
  viewerId?: string,
): MessageReaction[] {
  const byEmoji = new Map<string, { count: number; mine: boolean }>()
  for (const r of raw) {
    const entry = byEmoji.get(r.emoji) ?? { count: 0, mine: false }
    entry.count += 1
    if (viewerId && String(r.userId) === viewerId) entry.mine = true
    byEmoji.set(r.emoji, entry)
  }
  return [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v }))
}

// Project a set of memberships (that carry a bound userId) into ChatMembers.
// ONE query for every user, not one per member. This is a hot path (a group is
// ~30 members, the organizers channel can be 100) and the DB is remote, so a
// per-member findById costs N network round-trips, not N cheap lookups.
async function membersFrom(
  memberships: { userId?: unknown; role: string }[],
): Promise<ChatMember[]> {
  const bound = memberships.filter((m) => m.userId)
  if (!bound.length) return []

  const users = await UserModel.find({ _id: { $in: bound.map((m) => m.userId) } })
    .select('name surname photo')
    .lean()
  const byId = new Map(users.map((u) => [String(u._id), u]))

  // Input order is preserved; a bound membership whose user row is gone degrades
  // to an empty name, exactly as the old per-id lookup did.
  return bound.map((m) => {
    const u = byId.get(String(m.userId))
    const name = u ? `${u.name ?? ''} ${u.surname ?? ''}`.trim() : ''
    return {
      id: String(m.userId),
      name,
      initials: initialsOf(name),
      color: colorFor(String(m.userId)),
      photo: u?.photo ?? null,
      role: m.role,
    }
  })
}

export const chatService = {
  toChatMessage,

  // Latest N for an exact room, oldest→newest (the client appends).
  history: async (
    campId: Types.ObjectId,
    channel: MessageChannel,
    groupId: Types.ObjectId | null,
    viewerId?: string,
  ) => {
    // .lean() — every one of these rows is projected straight to a DTO below, so
    // Mongoose document hydration is pure overhead.
    const docs = await MessageModel.find({ campId, channel, groupId })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .lean()
    return docs.reverse().map((d) => toChatMessage(d, viewerId))
  },

  // Every membership (any role) in the group room = participants + the coordinator.
  groupMembers: async (campId: Types.ObjectId, groupId: Types.ObjectId): Promise<ChatMember[]> => {
    const rows = await MembershipModel.find({ campId, groupId }).lean()
    return membersFrom(rows)
  },

  // Every organizer-tier membership in the camp (manager + 6 sub-roles).
  organizerMembers: async (campId: Types.ObjectId): Promise<ChatMember[]> => {
    const rows = await MembershipModel.find({
      campId,
      role: { $in: ['manager', ...ORGANIZER_SUB_ROLES] },
    }).lean()
    return membersFrom(rows)
  },

  listGroupHistory: async (campId: Types.ObjectId, groupId: Types.ObjectId, viewerId?: string) => {
    // These three are independent. Awaiting them inside an object literal would
    // evaluate them in source order — three serial round-trips to a remote DB.
    const [members, messages, othersRead] = await Promise.all([
      chatService.groupMembers(campId, groupId),
      chatService.history(campId, 'group', groupId, viewerId),
      viewerId
        ? chatReadService.othersLastReadAt({
            campId,
            channel: 'group',
            groupId,
            exceptUserId: new Types.ObjectId(viewerId),
          })
        : Promise.resolve(null),
    ])
    return {
      groupId: String(groupId),
      members,
      messages,
      othersLastReadAt: othersRead?.toISOString() ?? null,
    }
  },

  listOrganizersHistory: async (campId: Types.ObjectId, viewerId?: string) => {
    const [members, messages, othersRead] = await Promise.all([
      chatService.organizerMembers(campId),
      chatService.history(campId, 'organizers', null, viewerId),
      viewerId
        ? chatReadService.othersLastReadAt({
            campId,
            channel: 'organizers',
            groupId: null,
            exceptUserId: new Types.ObjectId(viewerId),
          })
        : Promise.resolve(null),
    ])
    return { members, messages, othersLastReadAt: othersRead?.toISOString() ?? null }
  },

  // Persist + project. The one write path both REST (none today) and the socket
  // use. Resolves an optional reply target to a room-scoped snapshot; a target
  // outside this room (or missing) is dropped, degrading to a normal message.
  postMessage: async (input: {
    campId: Types.ObjectId
    channel: MessageChannel
    groupId: Types.ObjectId | null
    authorId: Types.ObjectId
    text: string
    replyToId?: Types.ObjectId
  }): Promise<ChatMessage> => {
    const groupId = input.channel === 'group' ? input.groupId : null

    let replyTo: { messageId: Types.ObjectId; authorName: string; text: string } | null = null
    if (input.replyToId) {
      const orig = await MessageModel.findOne({
        _id: input.replyToId,
        campId: input.campId,
        channel: input.channel,
        groupId,
      })
      if (orig) {
        const author = await UserModel.findById(orig.authorId)
        const authorName = author ? `${author.name ?? ''} ${author.surname ?? ''}`.trim() : ''
        replyTo = { messageId: orig._id, authorName, text: snippet(orig.text) }
      }
    }

    const doc = await MessageModel.create({
      campId: input.campId,
      channel: input.channel,
      groupId,
      authorId: input.authorId,
      text: input.text,
      replyTo,
    })
    return toChatMessage(doc)
  },

  // Toggle one {user, emoji} pair on a message; returns the message's { emoji, count }
  // aggregate (identities are never broadcast — mine is computed client-side).
  toggleReaction: async (input: {
    messageId: Types.ObjectId
    userId: Types.ObjectId
    emoji: string
  }): Promise<{ emoji: string; count: number }[]> => {
    const doc = await MessageModel.findById(input.messageId)
    if (!doc) throw new Error('message_not_found')
    const has = (doc.reactions ?? []).some(
      (r) => String(r.userId) === String(input.userId) && r.emoji === input.emoji,
    )
    if (has) {
      await MessageModel.updateOne(
        { _id: input.messageId },
        { $pull: { reactions: { userId: input.userId, emoji: input.emoji } } },
      )
    } else {
      await MessageModel.updateOne(
        { _id: input.messageId },
        { $push: { reactions: { userId: input.userId, emoji: input.emoji } } },
      )
    }
    const fresh = await MessageModel.findById(input.messageId)
    const counts = new Map<string, number>()
    for (const r of fresh?.reactions ?? []) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1)
    return [...counts.entries()].map(([emoji, count]) => ({ emoji, count }))
  },
}
