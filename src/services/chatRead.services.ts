import { Types } from 'mongoose'
import { ChatReadModel } from '../models/chatRead.model'
import { MessageModel, type MessageChannel } from '../models/message.model'

type Room = { campId: Types.ObjectId; channel: MessageChannel; groupId: Types.ObjectId | null }

export const chatReadService = {
  // Upsert this member's lastReadAt = now. Returns the timestamp for broadcasting.
  mark: async (room: Room & { userId: Types.ObjectId }): Promise<Date> => {
    const now = new Date()
    await ChatReadModel.updateOne(
      { campId: room.campId, channel: room.channel, groupId: room.groupId, userId: room.userId },
      { $set: { lastReadAt: now } },
      { upsert: true },
    )
    return now
  },

  // Max lastReadAt among members OTHER than exceptUserId — the "seen by anyone" seed.
  othersLastReadAt: async (room: Room & { exceptUserId: Types.ObjectId }): Promise<Date | null> => {
    const rows = await ChatReadModel.find({
      campId: room.campId,
      channel: room.channel,
      groupId: room.groupId,
      userId: { $ne: room.exceptUserId },
    })
      .sort({ lastReadAt: -1 })
      .limit(1)
    return rows[0]?.lastReadAt ?? null
  },

  // For each room, count messages authored by others after MY lastReadAt.
  unreadCounts: async (
    userId: Types.ObjectId,
    rooms: { campId: Types.ObjectId; channel: MessageChannel; groupId: Types.ObjectId | null }[],
  ): Promise<{ channel: MessageChannel; groupId: string | null; count: number }[]> => {
    const out: { channel: MessageChannel; groupId: string | null; count: number }[] = []
    for (const r of rooms) {
      const mark = await ChatReadModel.findOne({
        campId: r.campId,
        channel: r.channel,
        groupId: r.groupId,
        userId,
      })
      const after = mark?.lastReadAt ?? new Date(0)
      const count = await MessageModel.countDocuments({
        campId: r.campId,
        channel: r.channel,
        groupId: r.groupId,
        authorId: { $ne: userId },
        createdAt: { $gt: after },
      })
      out.push({ channel: r.channel, groupId: r.groupId ? String(r.groupId) : null, count })
    }
    return out
  },
}
