import './types'
import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { env } from '../config/env'
import { socketAuth } from './auth'
import { registerChatHandlers } from './chat.handlers'
import { registerMapHandlers } from './map.handlers'

let io: Server | null = null

export function attachSockets(server: HttpServer): Server {
  io = new Server(server, {
    // Same cross-origin posture as Express CORS — the cookie must ride the handshake.
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  })

  io.use(socketAuth)
  io.on('connection', (socket) => {
    registerChatHandlers(io!, socket)
    registerMapHandlers(io!, socket)
  })

  return io
}

// Emit from anywhere (handlers) without threading the instance through every call.
export function getIo(): Server {
  if (!io) throw new Error('Socket.IO not initialised')
  return io
}
