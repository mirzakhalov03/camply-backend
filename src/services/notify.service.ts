import { Types } from 'mongoose'
import { UserModel } from '../models/user.model'
import { pushSender } from './push/sender'
import { newMessagePush } from '../i18n/notifications'

type Lang = 'uz' | 'ru' | 'en'

export const notify = {
  // Push a new chat message to room members who are NOT currently connected to the
  // room (and never the author). Copy is rendered in each recipient's language.
  chatMessage: async (input: {
    campId: string
    channel: 'group' | 'organizers'
    groupId: string | null
    authorId: string
    authorName: string
    text: string
    roomMemberIds: string[]
    connectedUserIds: string[]
  }): Promise<void> => {
    const connected = new Set([...input.connectedUserIds, input.authorId])
    const recipients = input.roomMemberIds.filter((id) => !connected.has(id))
    if (recipients.length === 0) return

    const url = input.channel === 'organizers' ? '/org/chat' : '/camp/chat'
    const users = await UserModel.find({
      _id: { $in: recipients.map((r) => new Types.ObjectId(r)) },
    })
    await Promise.all(
      users.map((u) => {
        const lang = ((u.language as Lang) ?? 'uz') as Lang
        const { title, body } = newMessagePush(lang, input.channel, input.authorName, input.text)
        return pushSender.sendToUser(u._id, {
          title,
          body,
          url,
          tag: `chat:${input.campId}:${input.channel}`,
        })
      }),
    )
  },
}
