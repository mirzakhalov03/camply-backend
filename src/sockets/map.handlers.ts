import type { Server, Socket } from 'socket.io'
import { Types } from 'mongoose'
import { MembershipModel, ORGANIZER_SUB_ROLES } from '../models/membership.model'
import { locationService } from '../services/location.services'
import { reportSchema } from '../validators/location.validators'
import { HttpError } from '../middlewares/error.middleware'

/*
  Live map sockets. Rooms are SERVER-DERIVED — the client never names one, so it can
  never ask for a room it isn't entitled to. Same authority model as chat.

    map:{campId}:group:{groupId}  that group's participants + their coordinator
    map:{campId}:staff           organizer-tier memberships, manager, organization

  A position fans out to the reporter's GROUP room and the STAFF room. Visibility is
  therefore decided once, at broadcast, by who is standing in which room — which is the
  only shape that can make one person's position visible and invisible simultaneously
  to different viewers (design §5.2). A controller-level or component-level filter
  cannot express that.
*/

const groupRoom = (campId: string, groupId: string) => `map:${campId}:group:${groupId}`
const staffRoom = (campId: string) => `map:${campId}:staff`

const isOrganizerTier = (role: string) =>
  role === 'manager' || (ORGANIZER_SUB_ROLES as readonly string[]).includes(role)

/** Reports closer together than this are dropped, whatever the client's throttle does. */
const MIN_REPORT_INTERVAL_MS = 10_000

export function registerMapHandlers(io: Server, socket: Socket): void {
  const userId = new Types.ObjectId(socket.data.user.id)
  const accountRole = socket.data.user.role
  let lastReportAt = 0

  /*
    Local catch wrapper — the same rule chat learned the hard way. Socket.IO does NOT
    await handlers, so a rejected promise is an unhandled rejection, which on modern
    Node terminates the process. There is no Express error middleware on this path.

    `locationService.report` throws HttpError(403) outside camp hours and 404 on a
    missing camp; unwrapped, that is a one-message API kill.
  */
  const on = <T>(event: string, handler: (payload: T) => Promise<void>) => {
    socket.on(event, (payload: T) => {
      void handler(payload).catch((err: unknown) => {
        if (err instanceof HttpError) {
          socket.emit('map:error', {
            code: err.status === 403 ? 'forbidden' : 'invalid',
            message: err.message,
          })
          return
        }
        console.error(`[socket] ${event} failed:`, err)
        socket.emit('map:error', { code: 'server_error', message: 'Something went wrong' })
      })
    })
  }

  on('map:connectCamp', async ({ campId }: { campId: string }) => {
    if (!Types.ObjectId.isValid(campId)) throw new HttpError(400, 'Invalid campId')

    const m = await MembershipModel.findOne({ campId, userId }).select('role groupId')
    const isStaff =
      accountRole === 'organization' ||
      accountRole === 'manager' ||
      (m ? isOrganizerTier(m.role) : false)

    // An org super-admin has no membership row; anyone else needs one.
    if (!m && !isStaff) throw new HttpError(403, 'Not a member of this camp')

    if (m?.groupId) await socket.join(groupRoom(campId, String(m.groupId)))
    if (isStaff) await socket.join(staffRoom(campId))
  })

  on('map:report', async (payload: unknown) => {
    const parsed = reportSchema.safeParse(payload)
    if (!parsed.success) throw new HttpError(400, 'Invalid report')

    const now = Date.now()
    // Silent drop, not an error: the client is behaving, just eagerly.
    if (now - lastReportAt < MIN_REPORT_INTERVAL_MS) return
    lastReportAt = now

    const { campId, lat, lon, accuracyM } = parsed.data
    const result = await locationService.report({
      campId: new Types.ObjectId(campId),
      userId,
      pos: { lat, lon },
      accuracyM,
    })

    if (result.pin) {
      // Sharing ON: the group sees the pin, staff see the pin.
      if (result.groupId) {
        io.to(groupRoom(campId, result.groupId)).emit('map:pin', result.pin)
      }
      io.to(staffRoom(campId)).emit('map:pin', result.pin)
      return
    }
    /*
      Sharing OFF: the group room hears NOTHING. Staff hear only that the flag flipped —
      and only on a change, so a stationary hidden participant doesn't emit every minute.
    */
    if (result.hidden && result.changed) {
      io.to(staffRoom(campId)).emit('map:hidden', {
        userId: result.hidden.userId,
        outOfBounds: result.hidden.outOfBounds,
      })
    }
  })
}
