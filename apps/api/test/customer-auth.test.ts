import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { loadConfig } from '../src/config/env'
import { createAuth } from '../src/plugins/auth/auth'
import { identityEmailClaim, staffInvitation, user } from '../src/database/schema'
import { IdentityClaimRepository } from '../src/modules/identity-claims/repository'
import { IdentityClaimService } from '../src/modules/identity-claims/service'
import { CustomerSignupService } from '../src/modules/auth/customer/service'
import { createCustomerAuthModule } from '../src/modules/auth/customer'
import { testEnv } from './fixtures'
import { FakeEmailSender } from './helpers/fakes'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from './helpers/database'

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
let dummyHashes = 0

const createService = () => new CustomerSignupService({
  auth,
  claims: new IdentityClaimService(database.db, new IdentityClaimRepository()),
  limiter: {
    consume: async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0, resetAt: new Date() }),
  },
  dummyPasswordHash: async () => {
    dummyHashes += 1
  },
})

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

afterAll(async () => {
  await Promise.allSettled(backgroundTasks)
  await unlockDatabase?.()
  await database.client.end()
})

describe('serialized customer signup', () => {
  it('returns a constant response, creates one customer claim, and sends verification', async () => {
    const result = await createService().signupCustomer({
      email: ' Customer@Example.com ',
      password: 'correct horse battery staple',
      name: 'Customer',
      accountType: 'staff',
      role: 'owner',
    } as never)

    expect(result).toEqual({ accepted: true, next: 'sign-in' })
    const [createdUser] = await database.db.select().from(user)
      .where(eq(user.email, 'customer@example.com'))
    const [claim] = await database.db.select().from(identityEmailClaim)
      .where(eq(identityEmailClaim.normalizedEmail, 'customer@example.com'))
    expect(createdUser).toMatchObject({ accountType: 'customer', role: 'customer' })
    expect(claim).toMatchObject({ state: 'customer', userId: createdUser!.id })
    await Promise.all(backgroundTasks)
    expect(emailSender.messages).toHaveLength(1)
  })

  it('makes occupied customer signup indistinguishable and performs a dummy hash', async () => {
    const before = dummyHashes
    const result = await createService().signupCustomer({
      email: 'customer@example.com',
      password: 'another correct horse battery staple',
      name: 'Duplicate',
    })

    expect(result).toEqual({ accepted: true, next: 'sign-in' })
    expect(dummyHashes).toBe(before + 1)
  })

  it('makes staff and pending-invitation reservations indistinguishable', async () => {
    await database.db.insert(user).values({
      id: 'staff-owner',
      name: 'Owner',
      email: 'owner@example.com',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      accountType: 'staff',
      role: 'owner',
      staffActivatedAt: new Date(),
    })
    await database.db.insert(identityEmailClaim).values({
      normalizedEmail: 'owner@example.com',
      state: 'staff',
      userId: 'staff-owner',
    })
    await database.db.insert(staffInvitation).values({
      id: 'pending-invite',
      normalizedEmail: 'pending@example.com',
      role: 'support',
      tokenHash: 'pending-token-hash',
      inviterUserId: 'staff-owner',
      expiresAt: new Date(Date.now() + 60_000),
    })
    await database.db.insert(identityEmailClaim).values({
      normalizedEmail: 'pending@example.com',
      state: 'pending_staff',
      invitationId: 'pending-invite',
    })
    const before = dummyHashes
    const results = await Promise.all([
      createService().signupCustomer({
        email: 'owner@example.com',
        password: 'correct horse battery staple',
        name: 'Duplicate Staff',
      }),
      createService().signupCustomer({
        email: 'pending@example.com',
        password: 'correct horse battery staple',
        name: 'Pending Staff',
      }),
    ])

    expect(results).toEqual([
      { accepted: true, next: 'sign-in' },
      { accepted: true, next: 'sign-in' },
    ])
    expect(dummyHashes).toBe(before + 2)
  })

  it('serializes concurrent same-email attempts into one user and one claim', async () => {
    const commands = [createService(), createService()].map((service) => service.signupCustomer({
      email: 'race@example.com',
      password: 'correct horse battery staple',
      name: 'Race',
    }))
    const results = await Promise.allSettled(commands)
    const users = await database.db.select().from(user).where(eq(user.email, 'race@example.com'))
    const claims = await database.db.select().from(identityEmailClaim)
      .where(eq(identityEmailClaim.normalizedEmail, 'race@example.com'))

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
    expect(results.map((result) => result.status === 'fulfilled' ? result.value : null))
      .toEqual([
        { accepted: true, next: 'sign-in' },
        { accepted: true, next: 'sign-in' },
      ])
    expect(users).toHaveLength(1)
    expect(claims).toHaveLength(1)
    expect(claims[0]?.userId).toBe(users[0]?.id)
  })

  it('exposes a storefront-origin JSON-only route that discards hostile fields', async () => {
    const app = createCustomerAuthModule(config, createService())
    const valid = await app.handle(new Request('http://localhost/api/v1/customer-auth/sign-up', {
      method: 'POST',
      headers: {
        origin: config.storefrontUrl,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: ' Route@Example.com ',
        password: 'correct horse battery staple',
        name: 'Route Customer',
      }),
    }))
    const hostile = await app.handle(new Request('http://localhost/api/v1/customer-auth/sign-up', {
      method: 'POST',
      headers: {
        origin: config.storefrontUrl,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'hostile-route@example.com',
        password: 'correct horse battery staple',
        name: 'Hostile',
        role: 'owner',
      }),
    }))

    expect(valid.status).toBe(200)
    expect(await valid.json()).toEqual({ accepted: true, next: 'sign-in' })
    expect(hostile.status).toBe(200)
    const [hostileUser] = await database.db.select().from(user)
      .where(eq(user.email, 'hostile-route@example.com'))
    expect(hostileUser).toMatchObject({ accountType: 'customer', role: 'customer' })
  })
})
