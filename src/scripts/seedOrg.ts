import 'dotenv/config'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { connectDB } from '../config/db'
import { env } from '../config/env'
import { UserModel } from '../models/user.model'

// Dev-only: provisions the single organization super-admin. There is NO public
// path to become an organization (Context.md guardrail). Logs in by username.
async function seedOrg() {
  await connectDB()
  const username = env.SEED_ORG_USERNAME.toLowerCase()

  const existing = await UserModel.findOne({ username })
  if (existing) {
    console.log('ℹ️  Organization already exists:', username)
    await mongoose.disconnect()
    return
  }

  const passwordHash = await bcrypt.hash(env.SEED_ORG_PASSWORD, 12)
  await UserModel.create({
    username,
    name: 'Camply',
    surname: 'Organization',
    role: 'organization',
    active: true,
    passwordHash,
  })
  console.log('✅ Organization seeded:', username)
  await mongoose.disconnect()
}

seedOrg()
