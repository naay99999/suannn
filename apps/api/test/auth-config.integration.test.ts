import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { loadConfig } from '../src/config/env'
import { createAuth } from '../src/plugins/auth/auth'
import { testEnv } from './fixtures'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from './helpers/database'
import { FakeEmailSender } from './helpers/fakes'

const database = createTestDatabase()
const config = loadConfig({ ...testEnv, DATABASE_URL: database.url })
const emailSender = new FakeEmailSender()
const backgroundTasks: Promise<unknown>[] = []
const auth = createAuth(config, database.db, {
  emailSender,
  runInBackground(task) {
    backgroundTasks.push(task)
  },
})
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

describe('Better Auth against the migrated database', () => {
  it('creates a customer without issuing a signup session', async () => {
    const response = await auth.api.signUpEmail({
      body: {
        name: 'Customer',
        email: 'customer@example.com',
        password: 'correct horse battery staple',
      },
    })

    expect(response.token).toBeNull()
    expect(response.user.email).toBe('customer@example.com')
    expect(response.user.accountType).toBe('customer')
    await Promise.all(backgroundTasks)
    expect(emailSender.messages[0]).toMatchObject({
      to: 'customer@example.com',
      template: 'verify-email',
    })
  })

  it('does not accept server-owned fields from public signup', async () => {
    await expect(auth.api.signUpEmail({
      body: {
        name: 'Hostile',
        email: 'hostile@example.com',
        password: 'correct horse battery staple',
        accountType: 'staff',
        role: 'owner',
      } as never,
    })).rejects.toThrow('role is not allowed to be set')
  })
})
