import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import { createIdentityLockPool } from '../../src/database/client'
import { applicationRateLimit, customerPendingEmailChange, identityEmailClaim, session, staffInvitation, user } from '../../src/database/schema'
import { CustomerEmailChangeRepository } from '../../src/modules/customer/email-change/repository'
import { CustomerEmailChangeService } from '../../src/modules/customer/email-change/service'
import { createCustomerEmailChangeModule } from '../../src/modules/customer/email-change'
import { IdentityClaimRepository } from '../../src/modules/identity-claims/repository'
import { IdentityClaimService } from '../../src/modules/identity-claims/service'
import { ApplicationRateLimitRepository } from '../../src/modules/rate-limit/repository'
import { RateLimiter } from '../../src/modules/rate-limit/service'
import { createAuth } from '../../src/plugins/auth/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'
import { testEnv } from '../fixtures'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const config = loadConfig({ ...testEnv, DATABASE_URL: database.url })
const lockPool = createIdentityLockPool(database.url)
const sent: Array<{ to: string; text: string }> = []
const emailSender = { send: async (message: { to: string; text: string }) => {
  sent.push(message)
  return { id: 'test-email' }
} }
const auth = createAuth(config, database.db, { emailSender, runInBackground: () => undefined })
const service = new CustomerEmailChangeService({
  repository: new CustomerEmailChangeRepository(database.db),
  claims: new IdentityClaimService(database.db, new IdentityClaimRepository(), () => new Date(), lockPool),
  secret: config.betterAuthSecret,
  emailSender,
  runInBackground: (task) => void task(),
  generateCode: () => '01234567',
})
const app = new Elysia().use(createErrorHandlingPlugin()).use(createCustomerEmailChangeModule(
  config, auth, service, new RateLimiter(new ApplicationRateLimitRepository(database.db)),
))
let unlock: (() => Promise<void>) | undefined
let customerId = ''
let cookie = ''

function request(newEmail: string, currentPassword = 'correct horse battery staple') {
  return app.handle(new Request('http://localhost/api/v1/customer/email-change/request', {
    method: 'POST',
    headers: { cookie, origin: config.storefrontUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ newEmail, currentPassword }),
  }))
}

beforeAll(async () => {
  unlock = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const signup = await auth.api.signUpEmail({
    body: { name: 'Customer', email: 'old@example.com', password: 'correct horse battery staple' },
  })
  customerId = signup.user.id
  await database.db.insert(identityEmailClaim).values({
    normalizedEmail: 'old@example.com', state: 'customer', userId: customerId,
  })
  const signIn = await auth.api.signInEmail({
    body: { email: 'old@example.com', password: 'correct horse battery staple' },
    returnHeaders: true,
  })
  cookie = signIn.headers.get('set-cookie') ?? ''
})

afterAll(async () => {
  await unlock?.()
  await lockPool.end()
  await database.client.end()
})

describe('customer email change request persistence', () => {
  it('requires a customer session and storefront mutation origin', async () => {
    const anonymous = await app.handle(new Request('http://localhost/api/v1/customer/email-change/request', {
      method: 'POST',
      headers: { origin: config.storefrontUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ newEmail: 'new@example.com', currentPassword: 'correct horse battery staple' }),
    }))
    expect(anonymous.status).toBe(401)

    const wrongOrigin = await app.handle(new Request('http://localhost/api/v1/customer/email-change/request', {
      method: 'POST',
      headers: { cookie, origin: config.adminUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ newEmail: 'new@example.com', currentPassword: 'correct horse battery staple' }),
    }))
    expect(wrongOrigin.status).toBe(403)
  })

  it('stores a digest and expiry, sends only to the normalized address, and creates no session', async () => {
    const sessionsBefore = await database.db.select().from(session).where(eq(session.userId, customerId))
    const response = await request('NEW@Example.com')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ accepted: true })
    const [pending] = await database.db.select().from(customerPendingEmailChange)
      .where(eq(customerPendingEmailChange.userId, customerId))
    expect(pending).toMatchObject({ newEmail: 'new@example.com', failedAttempts: 0 })
    expect(pending?.codeDigest).not.toContain('01234567')
    expect(pending!.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000)
    expect(sent.at(-1)).toMatchObject({ to: 'new@example.com' })
    expect(sent.at(-1)?.text).toContain('01234567')
    const sessionsAfter = await database.db.select().from(session).where(eq(session.userId, customerId))
    expect(sessionsAfter).toHaveLength(sessionsBefore.length)
  })

  it('rejects a wrong password without replacing the pending request', async () => {
    const response = await request('wrong@example.com', 'wrong password')
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ code: 'INVALID_CURRENT_PASSWORD', message: 'Current password is invalid' })
    const [pending] = await database.db.select().from(customerPendingEmailChange)
      .where(eq(customerPendingEmailChange.userId, customerId))
    expect(pending?.newEmail).toBe('new@example.com')
  })

  it('rejects an address held by a pending staff invitation claim', async () => {
    await database.db.insert(user).values({
      id: 'staff-1', name: 'Staff', email: 'staff@example.com', emailVerified: true,
      createdAt: new Date(), updatedAt: new Date(), accountType: 'staff', role: 'owner',
    })
    await database.db.insert(staffInvitation).values({
      id: 'invitation-1', normalizedEmail: 'reserved@example.com', role: 'support',
      tokenHash: 'token-hash-1', inviterUserId: 'staff-1',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    await database.db.insert(identityEmailClaim).values({
      normalizedEmail: 'reserved@example.com', state: 'pending_staff', invitationId: 'invitation-1',
    })
    const response = await request('reserved@example.com')
    expect(response.status).toBe(409)
  })

  it('limits the fourth request for this customer and IP within one hour', async () => {
    await database.db.delete(applicationRateLimit)
    for (const email of ['second@example.com', 'third@example.com', 'another@example.com']) {
      const allowed = await request(email)
      expect(allowed.status).toBe(200)
    }
    const fourth = await request('fourth@example.com')
    expect(fourth.status).toBe(429)
    expect(fourth.headers.get('retry-after')).toBeTruthy()
    expect(await fourth.json()).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests' })
  })
})
