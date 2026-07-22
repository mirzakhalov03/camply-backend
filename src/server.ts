import { createServer } from 'node:http'
import { createApp } from './app'
import { attachSockets } from './sockets'
import { connectDB } from './config/db'
import { env } from './config/env'

async function bootstrap() {
  await connectDB()

  const app = createApp()
  const server = createServer(app)
  attachSockets(server) // Socket.IO shares the same HTTP server as Express

  server.listen(env.PORT, () => {
    console.log(`🚀 Server running on http://localhost:${env.PORT} (${env.NODE_ENV})`)
  })
}

bootstrap()
