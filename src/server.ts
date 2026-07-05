import { createApp } from './app'
import { connectDB } from './config/db'
import { env } from './config/env'

async function bootstrap() {
  await connectDB()

  const app = createApp()
  app.listen(env.PORT, () => {
    console.log(`🚀 Server running on http://localhost:${env.PORT} (${env.NODE_ENV})`)
  })
}

bootstrap()
