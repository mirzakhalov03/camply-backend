import type { Server, Socket } from 'socket.io'
import { Types } from 'mongoose'
import { MembershipModel, ORGANIZER_SUB_ROLES } from '../models/membership.model'
import { CampModel } from '../models/camp.model'
import { chatService } from '../services/chat.services'
import {
  sendMessageSchema,
  reactMessageSchema,
  readMessagesSchema,
} from '../validators/chat.validators'
import { chatReadService } from '../services/chatRead.services'
import { notify } from '../services/notify.service'

const groupRoom = (campId: string, groupId: string) => `group:${campId}:${groupId}`
const orgRoom = (campId: string) => `organizers:${campId}`

const isOrganizerTier = (role: string) =>
  role === 'manager' || (ORGANIZER_SUB_ROLES as readonly string[]).includes(role)

// The set of userIds currently connected to a room (in-memory, single-process).
async function onlineUserIds(io: Server, room: string): Promise<string[]> {
  const sockets = await io.in(room).fetchSockets()
  return [...new Set(sockets.map((s) => s.data.user.id))]
}

export function registerChatHandlers(io: Server, socket: Socket): void {
  const user = socket.data.user

  socket.on('chat:connectCamp', async ({ campId }: { campId: string }) => {
    if (!Types.ObjectId.isValid(campId)) return
    const camp = await CampModel.findById(campId)
    if (!camp) return

    // Server-derived entitlements — the client NEVER names a room.
    let groupId: string | null = null
    let canOrganizers = false

    if (user.role === 'organization') {
      // The org super-admin sees any camp in its org; organizers room only.
      if (String(camp.organizationId) === user.id) canOrganizers = true
    } else {
      const membership = await MembershipModel.findOne({ campId, userId: user.id })
      if (membership) {
        if (membership.groupId) {
          groupId = String(membership.groupId)
          socket.join(groupRoom(campId, groupId)) // shared: participants + coordinator
        }
        if (isOrganizerTier(membership.role)) canOrganizers = true
      }
    }

    if (canOrganizers) socket.join(orgRoom(campId))

    const byCamp = socket.data.byCamp ?? new Map()
    byCamp.set(campId, { groupId, canOrganizers })
    socket.data.byCamp = byCamp

    // Presence: tell each joined room who's online now.
    if (groupId) {
      io.to(groupRoom(campId, groupId)).emit('chat:presence', {
        channel: 'group',
        groupId,
        onlineUserIds: await onlineUserIds(io, groupRoom(campId, groupId)),
      })
    }
    if (canOrganizers) {
      io.to(orgRoom(campId)).emit('chat:presence', {
        channel: 'organizers',
        groupId: null,
        onlineUserIds: await onlineUserIds(io, orgRoom(campId)),
      })
    }

    // Seed the unread badge for this socket: messages after my lastReadAt per room.
    const unreadRooms: {
      campId: Types.ObjectId
      channel: 'group' | 'organizers'
      groupId: Types.ObjectId | null
    }[] = []
    if (groupId)
      unreadRooms.push({ campId: camp._id, channel: 'group', groupId: new Types.ObjectId(groupId) })
    if (canOrganizers) unreadRooms.push({ campId: camp._id, channel: 'organizers', groupId: null })
    if (unreadRooms.length) {
      const counts = await chatReadService.unreadCounts(new Types.ObjectId(user.id), unreadRooms)
      socket.emit('chat:unread', { rooms: counts })
    }
  })

  socket.on('chat:send', async (payload: unknown) => {
    const parsed = sendMessageSchema.safeParse(payload)
    if (!parsed.success) {
      socket.emit('chat:error', { code: 'invalid', message: 'Invalid message' })
      return
    }
    const { campId, channel, text, replyToId } = parsed.data
    const entitlement = socket.data.byCamp?.get(campId)
    if (!entitlement) {
      socket.emit('chat:error', { code: 'not_connected', message: 'Not connected to this camp' })
      return
    }

    if (channel === 'organizers') {
      if (!entitlement.canOrganizers) {
        socket.emit('chat:error', { code: 'forbidden', message: 'Not an organizer here' })
        return
      }
      const message = await chatService.postMessage({
        campId: new Types.ObjectId(campId),
        channel: 'organizers',
        groupId: null,
        authorId: new Types.ObjectId(user.id),
        text,
        replyToId: replyToId ? new Types.ObjectId(replyToId) : undefined,
      })
      io.to(orgRoom(campId)).emit('chat:message', { channel: 'organizers', groupId: null, message })
      // Push to organizer-tier members who aren't currently connected to this room.
      const orgMembers = await chatService.organizerMembers(new Types.ObjectId(campId))
      const orgConnected = await onlineUserIds(io, orgRoom(campId))
      await notify.chatMessage({
        campId,
        channel: 'organizers',
        groupId: null,
        authorId: user.id,
        authorName: orgMembers.find((m) => m.id === user.id)?.name || 'Camply',
        text,
        roomMemberIds: orgMembers.map((m) => m.id),
        connectedUserIds: orgConnected,
      })
      return
    }

    // channel === 'group' — groupId is SERVER-derived; a client-sent one is ignored.
    if (!entitlement.groupId) {
      socket.emit('chat:error', { code: 'no_group', message: 'You are not in a group' })
      return
    }
    const groupId = entitlement.groupId
    const message = await chatService.postMessage({
      campId: new Types.ObjectId(campId),
      channel: 'group',
      groupId: new Types.ObjectId(groupId),
      authorId: new Types.ObjectId(user.id),
      text,
      replyToId: replyToId ? new Types.ObjectId(replyToId) : undefined,
    })
    io.to(groupRoom(campId, groupId)).emit('chat:message', { channel: 'group', groupId, message })
    // Push to group members who aren't currently connected to this room.
    const grpMembers = await chatService.groupMembers(
      new Types.ObjectId(campId),
      new Types.ObjectId(groupId),
    )
    const grpConnected = await onlineUserIds(io, groupRoom(campId, groupId))
    await notify.chatMessage({
      campId,
      channel: 'group',
      groupId,
      authorId: user.id,
      authorName: grpMembers.find((m) => m.id === user.id)?.name || 'Camply',
      text,
      roomMemberIds: grpMembers.map((m) => m.id),
      connectedUserIds: grpConnected,
    })
  })

  socket.on('chat:react', async (payload: unknown) => {
    const parsed = reactMessageSchema.safeParse(payload)
    if (!parsed.success) return
    const { campId, channel, messageId, emoji } = parsed.data
    const entitlement = socket.data.byCamp?.get(campId)
    if (!entitlement) return

    let room: string
    let groupId: string | null = null
    if (channel === 'organizers') {
      if (!entitlement.canOrganizers) return
      room = orgRoom(campId)
    } else {
      const gid = entitlement.groupId
      if (!gid) return
      groupId = gid
      room = groupRoom(campId, gid)
    }

    const reactions = await chatService.toggleReaction({
      messageId: new Types.ObjectId(messageId),
      userId: new Types.ObjectId(user.id),
      emoji,
    })
    io.to(room).emit('chat:reaction', { channel, groupId, messageId, reactions })
  })

  socket.on('chat:read', async (payload: unknown) => {
    const parsed = readMessagesSchema.safeParse(payload)
    if (!parsed.success) return
    const { campId, channel } = parsed.data
    const entitlement = socket.data.byCamp?.get(campId)
    if (!entitlement) return

    let room: string
    let groupId: Types.ObjectId | null = null
    if (channel === 'organizers') {
      if (!entitlement.canOrganizers) return
      room = orgRoom(campId)
    } else {
      const gid = entitlement.groupId
      if (!gid) return
      groupId = new Types.ObjectId(gid)
      room = groupRoom(campId, gid)
    }

    const lastReadAt = await chatReadService.mark({
      campId: new Types.ObjectId(campId),
      channel,
      groupId,
      userId: new Types.ObjectId(user.id),
    })
    io.to(room).emit('chat:read', {
      channel,
      groupId: groupId ? String(groupId) : null,
      userId: user.id,
      lastReadAt: lastReadAt.toISOString(),
    })
  })

  // On disconnect, socket.io auto-leaves rooms; re-emit presence for each room the
  // socket was in so remaining members see the drop.
  socket.on('disconnect', async () => {
    const byCamp = socket.data.byCamp
    if (!byCamp) return
    for (const [campId, e] of byCamp) {
      if (e.groupId) {
        io.to(groupRoom(campId, e.groupId)).emit('chat:presence', {
          channel: 'group',
          groupId: e.groupId,
          onlineUserIds: await onlineUserIds(io, groupRoom(campId, e.groupId)),
        })
      }
      if (e.canOrganizers) {
        io.to(orgRoom(campId)).emit('chat:presence', {
          channel: 'organizers',
          groupId: null,
          onlineUserIds: await onlineUserIds(io, orgRoom(campId)),
        })
      }
    }
  })
}
