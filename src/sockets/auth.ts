import type { Socket } from 'socket.io'
import { UserModel } from '../models/user.model'
import { sessionService } from '../services/session.services'
import { SESSION_COOKIE_NAME } from '../config/cookies'

// Minimal cookie-header parse — avoids a new dep. Returns the named cookie or null.
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return null
}

// Mirror requireAuth exactly: session must be live AND the user active. Reject the
// HANDSHAKE (not just a room join) so a deactivated account can't hold a live socket.
export async function socketAuth(socket: Socket, next: (err?: Error) => void): Promise<void> {
  try {
    const raw = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE_NAME)
    if (!raw) return next(new Error('Not authenticated'))

    const session = await sessionService.findLive(raw)
    if (!session) return next(new Error('Session expired'))

    const user = await UserModel.findById(session.userId)
    if (!user || !user.active) return next(new Error('Not authenticated'))

    socket.data.user = { id: String(user._id), role: user.role }
    next()
  } catch (err) {
    next(err as Error)
  }
}
