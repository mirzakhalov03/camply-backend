import { Types } from 'mongoose'
import { MessageModel, type Message, type MessageChannel } from '../models/message.model'
import { MembershipModel, ORGANIZER_SUB_ROLES } from '../models/membership.model'
import { UserModel } from '../models/user.model'
import { initialsOf, colorFor } from '../utils/avatar'

export const HISTORY_LIMIT = 50

// The frontend ChatMessage contract (lib/chat.ts). Text-only server-side: kind is
// always 'text'; sentByMe/status are resolved client-side. reactions are aggregated
// per viewer (mine is against viewerId).
export type MessageReaction = { emoji: string; count: number; mine: boolean }

export type ChatMessage = {
  id: string
  authorId: string
  kind: 'text'
  text: string
  time: string // HH:MM
  createdAt: string // ISO — the client can re-derive `time` and ordering
  reactions: MessageReaction[]
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

function toChatMessage(doc: Message, viewerId?: string): ChatMessage {
  const createdAt = (doc as unknown as { createdAt: Date }).createdAt
  return {
    id: String(doc._id),
    authorId: String(doc.authorId),
    kind: 'text',
    text: doc.text,
    time: hhmm(createdAt),
    createdAt: createdAt.toISOString(),
    reactions: aggregateReactions(doc.reactions ?? [], viewerId),
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
async function membersFrom(
  memberships: { userId?: unknown; role: string }[],
): Promise<ChatMember[]> {
  const bound = memberships.filter((m) => m.userId)
  const out: ChatMember[] = []
  for (const m of bound) {
    const u = await UserModel.findById(m.userId as Types.ObjectId)
    const name = u ? `${u.name ?? ''} ${u.surname ?? ''}`.trim() : ''
    out.push({
      id: String(m.userId),
      name,
      initials: initialsOf(name),
      color: colorFor(String(m.userId)),
      photo: u?.photo ?? null,
      role: m.role,
    })
  }
  return out
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
    const docs = await MessageModel.find({ campId, channel, groupId })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
    return docs.reverse().map((d) => toChatMessage(d, viewerId))
  },

  // Every membership (any role) in the group room = participants + the coordinator.
  groupMembers: async (campId: Types.ObjectId, groupId: Types.ObjectId): Promise<ChatMember[]> => {
    const rows = await MembershipModel.find({ campId, groupId })
    return membersFrom(rows)
  },

  // Every organizer-tier membership in the camp (manager + 6 sub-roles).
  organizerMembers: async (campId: Types.ObjectId): Promise<ChatMember[]> => {
    const rows = await MembershipModel.find({
      campId,
      role: { $in: ['manager', ...ORGANIZER_SUB_ROLES] },
    })
    return membersFrom(rows)
  },

  listGroupHistory: async (campId: Types.ObjectId, groupId: Types.ObjectId, viewerId?: string) => ({
    groupId: String(groupId),
    members: await chatService.groupMembers(campId, groupId),
    messages: await chatService.history(campId, 'group', groupId, viewerId),
  }),

  listOrganizersHistory: async (campId: Types.ObjectId, viewerId?: string) => ({
    members: await chatService.organizerMembers(campId),
    messages: await chatService.history(campId, 'organizers', null, viewerId),
  }),

  // Persist + project. The one write path both REST (none today) and the socket use.
  postMessage: async (input: {
    campId: Types.ObjectId
    channel: MessageChannel
    groupId: Types.ObjectId | null
    authorId: Types.ObjectId
    text: string
  }): Promise<ChatMessage> => {
    const doc = await MessageModel.create({
      campId: input.campId,
      channel: input.channel,
      groupId: input.channel === 'group' ? input.groupId : null,
      authorId: input.authorId,
      text: input.text,
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
