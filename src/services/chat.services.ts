import { Types } from 'mongoose'
import { MessageModel, type Message, type MessageChannel } from '../models/message.model'
import { MembershipModel, ORGANIZER_SUB_ROLES } from '../models/membership.model'
import { UserModel } from '../models/user.model'
import { initialsOf, colorFor } from '../utils/avatar'

export const HISTORY_LIMIT = 50

// The frontend ChatMessage contract (lib/chat.ts). Text-only server-side: kind is
// always 'text'; sentByMe/status/reactions are resolved/added client-side.
export type ChatMessage = {
  id: string
  authorId: string
  kind: 'text'
  text: string
  time: string // HH:MM
  createdAt: string // ISO — the client can re-derive `time` and ordering
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

function toChatMessage(doc: Message): ChatMessage {
  const createdAt = (doc as unknown as { createdAt: Date }).createdAt
  return {
    id: String(doc._id),
    authorId: String(doc.authorId),
    kind: 'text',
    text: doc.text,
    time: hhmm(createdAt),
    createdAt: createdAt.toISOString(),
  }
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
  ) => {
    const docs = await MessageModel.find({ campId, channel, groupId })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
    return docs.reverse().map(toChatMessage)
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

  listGroupHistory: async (campId: Types.ObjectId, groupId: Types.ObjectId) => ({
    groupId: String(groupId),
    members: await chatService.groupMembers(campId, groupId),
    messages: await chatService.history(campId, 'group', groupId),
  }),

  listOrganizersHistory: async (campId: Types.ObjectId) => ({
    members: await chatService.organizerMembers(campId),
    messages: await chatService.history(campId, 'organizers', null),
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
}
