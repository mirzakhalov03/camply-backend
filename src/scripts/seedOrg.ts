import 'dotenv/config'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { connectDB } from '../config/db'
import { env } from '../config/env'
import { UserModel } from '../models/user.model'
import { canonicalizePhone } from '../utils/phone'

// Dev-only: provisions the single organization super-admin. There is NO public
// path to become an organization (Context.md guardrail).
async function seedOrg() {
  if (!env.SEED_ORG_PHONE || !env.SEED_ORG_PASSWORD) {
    console.error('❌ Set SEED_ORG_PHONE and SEED_ORG_PASSWORD in .env first')
    process.exit(1)
  }

  await connectDB()
  const phone = canonicalizePhone(env.SEED_ORG_PHONE)

  const existing = await UserModel.findOne({ phone })
  if (existing) {
    console.log('ℹ️  Organization already exists:', phone)
    await mongoose.disconnect()
    return
  }

  const passwordHash = await bcrypt.hash(env.SEED_ORG_PASSWORD, 12)
  await UserModel.create({
    phone,
    name: 'Camply',
    surname: 'Organization',
    role: 'organization',
    passwordHash,
  })
  console.log('✅ Organization seeded:', phone)
  await mongoose.disconnect()
}

seedOrg()
