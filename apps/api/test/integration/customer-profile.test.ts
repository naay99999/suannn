import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import { user } from '../../src/database/schema'
import { createCustomerProfileModule } from '../../src/modules/customer/profile'
import { CustomerProfileRepository } from '../../src/modules/customer/profile/repository'
import { CustomerProfileService } from '../../src/modules/customer/profile/service'
import { createAuth } from '../../src/plugins/auth/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'
import { testEnv } from '../fixtures'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const config = loadConfig({ ...testEnv, DATABASE_URL: database.url })
const auth = createAuth(config, database.db, {
  emailSender: { send: async () => ({ id: 'test-email' }) },
  runInBackground: (task) => void task.catch(() => undefined),
})
const service = new CustomerProfileService(new CustomerProfileRepository(database.db))
const app = new Elysia().use(createErrorHandlingPlugin()).use(createCustomerProfileModule(config, auth, service))
let unlock: (() => Promise<void>) | undefined
let customerCookie = ''
let customerId = ''

beforeAll(async () => {
  unlock = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const signup = await auth.api.signUpEmail({
    body: { name: 'Customer', email: 'profile@example.com', password: 'correct horse battery staple' },
  })
  customerId = signup.user.id
  await database.db.update(user).set({ emailVerified: true }).where(eq(user.id, customerId))
  const signedIn = await auth.api.signInEmail({
    body: { email: 'profile@example.com', password: 'correct horse battery staple' },
    returnHeaders: true,
  })
  customerCookie = signedIn.headers.get('set-cookie') ?? ''
  await database.db.update(user).set({ emailVerified: false }).where(eq(user.id, customerId))
})

afterAll(async () => {
  await unlock?.()
  await database.client.end()
})

describe('customer profile persistence', () => {
  it('reads and renames an unverified customer without changing account fields', async () => {
    const get = await app.handle(new Request('http://localhost/api/v1/customer/profile', {
      headers: { cookie: customerCookie },
    }))
    expect(get.status).toBe(200)
    expect(await get.json()).toEqual({
      id: customerId, name: 'Customer', email: 'profile@example.com', emailVerified: false,
    })

    const patch = await app.handle(new Request('http://localhost/api/v1/customer/profile', {
      method: 'PATCH',
      headers: { cookie: customerCookie, origin: config.storefrontUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  New Name  ' }),
    }))
    expect(patch.status).toBe(200)
    expect(await patch.json()).toEqual({
      id: customerId, name: 'New Name', email: 'profile@example.com', emailVerified: false,
    })
    const [persisted] = await database.db.select().from(user).where(eq(user.id, customerId))
    expect(persisted).toMatchObject({
      name: 'New Name', email: 'profile@example.com', emailVerified: false,
      accountType: 'customer', role: 'customer',
    })
  })

  it('prevents reading or renaming a row after it becomes staff', async () => {
    await database.db.update(user).set({ accountType: 'staff' }).where(eq(user.id, customerId))
    await expect(service.get(customerId)).rejects.toThrow('CUSTOMER_ACCOUNT_REQUIRED')
    await expect(service.rename(customerId, 'Intrusion')).rejects.toThrow('CUSTOMER_ACCOUNT_REQUIRED')
    const [persisted] = await database.db.select().from(user).where(eq(user.id, customerId))
    expect(persisted?.name).toBe('New Name')
  })
})
