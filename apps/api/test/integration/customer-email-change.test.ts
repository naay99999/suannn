import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import { createIdentityLockPool } from '../../src/database/client'
import { auditLog, applicationRateLimit, customerPendingEmailChange, identityEmailClaim, session, staffInvitation, user } from '../../src/database/schema'
import { CustomerSignupService } from '../../src/modules/auth/customer/service'
import { StaffInvitationService } from '../../src/modules/auth/invitations/service'
import { StaffInvitationRepository } from '../../src/modules/auth/invitations/repository'
import type { AuditEvent } from '../../src/modules/audit/model'
import type { DatabaseTransaction } from '../../src/database/types'
import { AuditService } from '../../src/modules/audit/service'
import { AuditRepository } from '../../src/modules/audit/repository'
import { digestEmailChangeCode } from '../../src/modules/customer/email-change/code'
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
  audit: new AuditService(new AuditRepository(database.db)),
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


const confirmInput = { clientIp: '127.0.0.1', requestId: 'request-2', code: '12345678' }

async function confirmationFixture() {
  const userId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const oldEmail = `${userId}@old.example.com`
  const newEmail = `${userId}@new.example.com`
  await database.db.insert(user).values({
    id: userId, name: 'Customer', email: oldEmail, emailVerified: false,
    createdAt: new Date(), updatedAt: new Date(), accountType: 'customer', role: 'customer',
  })
  await database.db.insert(identityEmailClaim).values({ normalizedEmail: oldEmail, state: 'customer', userId })
  await database.db.insert(session).values([sessionId, crypto.randomUUID()].map((id) => ({
    id, userId, token: id, createdAt: new Date(), updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })))
  await database.db.insert(customerPendingEmailChange).values({
    userId, newEmail, codeDigest: digestEmailChangeCode(config.betterAuthSecret, userId, confirmInput.code),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  })
  const read = async () => ({
    user: (await database.db.select().from(user).where(eq(user.id, userId)))[0]!,
    oldClaim: (await database.db.select().from(identityEmailClaim).where(eq(identityEmailClaim.normalizedEmail, oldEmail)))[0] ?? null,
    newClaim: (await database.db.select().from(identityEmailClaim).where(eq(identityEmailClaim.normalizedEmail, newEmail)))[0] ?? null,
    pending: (await database.db.select().from(customerPendingEmailChange).where(eq(customerPendingEmailChange.userId, userId)))[0] ?? null,
    sessions: await database.db.select().from(session).where(eq(session.userId, userId)),
    audits: await database.db.select().from(auditLog).where(eq(auditLog.targetId, userId)),
  })
  return { userId, sessionId, oldEmail, newEmail, read, input: { ...confirmInput, userId, sessionId } }
}

describe('customer email confirmation persistence', () => {
  it('atomically transfers the claim, verifies email, consumes code and revokes every session', async () => {
    const f = await confirmationFixture()
    expect(await service.confirm(f.input)).toEqual({ changed: true })
    const after = await f.read()
    expect(after.user.email).toBe(f.newEmail)
    expect(after.user.emailVerified).toBe(true)
    expect(after.oldClaim).toBeNull()
    expect(after.newClaim).toMatchObject({ userId: f.userId, state: 'customer' })
    expect(after.pending).toBeNull()
    expect(after.sessions).toHaveLength(0)
    expect(after.audits).toHaveLength(1)
    expect(after.audits[0]).toMatchObject({ action: 'customer.email-changed', metadata: {}, requestId: 'request-2' })
    await expect(service.confirm(f.input)).rejects.toThrow('EMAIL_CHANGE_CODE_INVALID')
  })

  it('rejects an expired code without changing identity', async () => {
    const f = await confirmationFixture()
    await database.db.update(customerPendingEmailChange).set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(customerPendingEmailChange.userId, f.userId))
    await expect(service.confirm(f.input)).rejects.toThrow('EMAIL_CHANGE_CODE_EXPIRED')
    expect((await f.read()).user.email).toBe(f.oldEmail)
  })

  it('commits five incorrect attempts and rejects even the correct sixth code', async () => {
    const f = await confirmationFixture()
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(service.confirm({ ...f.input, code: '00000000' })).rejects.toThrow('EMAIL_CHANGE_CODE_INVALID')
      expect((await f.read()).pending?.failedAttempts).toBe(attempt)
    }
    await expect(service.confirm(f.input)).rejects.toThrow('EMAIL_CHANGE_CODE_INVALID')
    const after = await f.read()
    expect(after.pending?.failedAttempts).toBe(5)
    expect(after.user.email).toBe(f.oldEmail)
    expect(after.sessions).toHaveLength(2)
  })

  it('invalidates the old code after replacement', async () => {
    const f = await confirmationFixture()
    await new CustomerEmailChangeRepository(database.db).upsertPending(database.db as never, {
      userId: f.userId, newEmail: f.newEmail,
      codeDigest: digestEmailChangeCode(config.betterAuthSecret, f.userId, '87654321'),
      expiresAt: new Date(Date.now() + 600_000), failedAttempts: 0,
    })
    await expect(service.confirm(f.input)).rejects.toThrow('EMAIL_CHANGE_CODE_INVALID')
    expect(await service.confirm({ ...f.input, code: '87654321' })).toEqual({ changed: true })
  })

  it.each(['claim', 'user'])('rejects a new address occupied in the %s table', async (kind) => {
    const f = await confirmationFixture()
    if (kind === 'claim') {
      await database.db.insert(identityEmailClaim).values({ normalizedEmail: f.newEmail, state: 'pending_customer', operationId: crypto.randomUUID() })
    } else {
      await database.db.insert(user).values({ id: crypto.randomUUID(), email: f.newEmail, name: 'Other', role: 'customer', createdAt: new Date(), updatedAt: new Date() })
    }
    await expect(service.confirm(f.input)).rejects.toThrow('EMAIL_UNAVAILABLE')
    const after = await f.read()
    expect(after.user.email).toBe(f.oldEmail)
    expect(after.oldClaim?.userId).toBe(f.userId)
    expect(after.pending).not.toBeNull()
    expect(after.sessions).toHaveLength(2)
    expect(after.audits).toHaveLength(0)
  })

  it.each(['revoked', 'expired', 'foreign'])('rechecks a %s session before transferring', async (kind) => {
    const f = await confirmationFixture()
    if (kind === 'revoked') await database.db.delete(session).where(eq(session.id, f.sessionId))
    if (kind === 'expired') await database.db.update(session).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(session.id, f.sessionId))
    const input = kind === 'foreign' ? { ...f.input, sessionId: (await confirmationFixture()).sessionId } : f.input
    await expect(service.confirm(input)).rejects.toThrow('AUTHENTICATION_REQUIRED')
    const after = await f.read()
    expect(after.user.email).toBe(f.oldEmail)
    expect(after.newClaim).toBeNull()
    expect(after.pending).not.toBeNull()
    expect(after.audits).toHaveLength(0)
  })

  it('rolls back the entire transfer if the audit insert fails', async () => {
    const f = await confirmationFixture()
    const failingService = new CustomerEmailChangeService({
      repository: new CustomerEmailChangeRepository(database.db),
      claims: new IdentityClaimService(database.db, new IdentityClaimRepository(), () => new Date(), lockPool),
      audit: { record: async () => { throw new Error('audit unavailable') } },
      secret: config.betterAuthSecret, emailSender,
    })
    await expect(failingService.confirm(f.input)).rejects.toThrow('audit unavailable')
    const after = await f.read()
    expect(after.user.email).toBe(f.oldEmail)
    expect(after.oldClaim?.userId).toBe(f.userId)
    expect(after.newClaim).toBeNull()
    expect(after.pending).not.toBeNull()
    expect(after.sessions).toHaveLength(2)
  })

  it('requires JSON, storefront origin and a customer session for confirmation', async () => {
    for (const [headers, status] of [
      [{ origin: config.storefrontUrl, 'content-type': 'application/json' }, 401],
      [{ cookie, origin: config.adminUrl, 'content-type': 'application/json' }, 403],
      [{ cookie, origin: config.storefrontUrl, 'content-type': 'text/plain' }, 422],
    ] as const) {
      const response = await app.handle(new Request('http://localhost/api/v1/customer/email-change/confirm', {
        method: 'POST', headers, body: JSON.stringify({ code: '00000000' }),
      }))
      expect(response.status).toBe(status)
    }
  })

  it('returns safe errors and limits the sixth confirmation with retry-after', async () => {
    await database.db.delete(applicationRateLimit)
    for (let i = 0; i < 6; i += 1) {
      const response = await app.handle(new Request('http://localhost/api/v1/customer/email-change/confirm', {
        method: 'POST', headers: { cookie, origin: config.storefrontUrl, 'content-type': 'application/json' },
        body: JSON.stringify({ code: '00000000' }),
      }))
      expect(response.status).toBe(i === 5 ? 429 : 422)
      expect((await response.json() as { code: string }).code).toBe(i === 5 ? 'RATE_LIMITED' : 'EMAIL_CHANGE_CODE_INVALID')
      if (i === 5) expect(response.headers.get('retry-after')).toBeTruthy()
    }
  })
})


function observedClaims() {
  const blocked = Promise.withResolvers<void>()
  const claims = new IdentityClaimService(database.db, new IdentityClaimRepository(), () => new Date(), {
    reserve: async () => {
      const connection = await lockPool.reserve()
      return {
        unsafe: async <T>(query: string, parameters?: unknown[]): Promise<T[]> => {
          const result = await connection.unsafe(query, parameters as never[])
          if (query.includes('pg_try_advisory_lock($1::bigint)') && !result[0]?.acquired) blocked.resolve()
          return result as unknown as T[]
        },
        release: () => connection.release(),
      }
    },
  })
  return { claims, blocked }
}

it.each(['signup', 'invitation'] as const)('serializes confirmation ahead of concurrent %s', async (kind) => {
  const f = await confirmationFixture()
  const { claims, blocked } = observedClaims()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  class PausedRepository extends CustomerEmailChangeRepository {
    override async transferIdentity(tx: DatabaseTransaction, userId: string, oldEmail: string, newEmail: string) {
      entered.resolve()
      await release.promise
      return super.transferIdentity(tx, userId, oldEmail, newEmail)
    }
  }
  const audit = new AuditService(new AuditRepository(database.db))
  const confirming = new CustomerEmailChangeService({
    repository: new PausedRepository(database.db), claims, audit,
    secret: config.betterAuthSecret, emailSender,
  }).confirm(f.input)
  await entered.promise
  const competitor = kind === 'signup'
    ? new CustomerSignupService({ auth, claims, audit, limiter: new RateLimiter(new ApplicationRateLimitRepository(database.db)) })
      .signupCustomer({ email: f.newEmail, password: 'correct horse battery staple', name: 'Rival', ip: '127.0.0.1', requestId: 'rival' })
    : new StaffInvitationService({ auth, claims, audit, repository: new StaffInvitationRepository(database.db), emailSender,
      runInBackground: () => undefined, adminUrl: config.adminUrl })
      .create({ email: f.newEmail, role: 'support', inviterUserId: 'staff-1', inviterRole: 'owner' })
  const outcome = competitor.then(() => 'accepted', (error: Error) => error.message)
  await blocked.promise
  release.resolve()
  expect(await confirming).toEqual({ changed: true })
  expect(await outcome).toBe(kind === 'signup' ? 'accepted' : 'EMAIL_UNAVAILABLE')
  expect((await f.read()).newClaim).toMatchObject({ state: 'customer', userId: f.userId })
  expect(await database.db.select().from(user).where(eq(user.email, f.newEmail))).toHaveLength(1)
  expect(await database.db.select().from(staffInvitation).where(eq(staffInvitation.normalizedEmail, f.newEmail))).toHaveLength(0)
})

it.each(['signup', 'invitation'] as const)('rolls back confirmation after a concurrent %s wins the claim', async (kind) => {
  const f = await confirmationFixture()
  const { claims, blocked } = observedClaims()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  class PausedAudit extends AuditService {
    override async record(writer: Parameters<AuditService['record']>[0], event: AuditEvent) {
      entered.resolve()
      await release.promise
      return super.record(writer, event)
    }
  }
  const audit = new PausedAudit(new AuditRepository(database.db))
  const competitor = kind === 'signup'
    ? new CustomerSignupService({ auth, claims, audit, limiter: new RateLimiter(new ApplicationRateLimitRepository(database.db)) })
      .signupCustomer({ email: f.newEmail, password: 'correct horse battery staple', name: 'Rival', ip: '127.0.0.1', requestId: 'rival' })
    : new StaffInvitationService({ auth, claims, audit, repository: new StaffInvitationRepository(database.db), emailSender,
      runInBackground: () => undefined, adminUrl: config.adminUrl })
      .create({ email: f.newEmail, role: 'support', inviterUserId: 'staff-1', inviterRole: 'owner' })
  await entered.promise
  const confirming = new CustomerEmailChangeService({
    repository: new CustomerEmailChangeRepository(database.db), claims,
    audit: new AuditService(new AuditRepository(database.db)), secret: config.betterAuthSecret, emailSender,
  }).confirm(f.input).then(() => 'changed', (error: Error) => error.message)
  await blocked.promise
  release.resolve()
  await competitor
  expect(await confirming).toBe('EMAIL_UNAVAILABLE')
  const after = await f.read()
  expect(after.user.email).toBe(f.oldEmail)
  expect(after.oldClaim?.userId).toBe(f.userId)
  expect(after.newClaim?.state).toBe(kind === 'signup' ? 'customer' : 'pending_staff')
  expect(after.newClaim?.userId).not.toBe(f.userId)
  expect(after.pending).not.toBeNull()
  expect(after.sessions).toHaveLength(2)
  expect(after.audits).toHaveLength(0)
})

it('rejects a session revoked while confirmation waits for the email lock', async () => {
  const f = await confirmationFixture()
  const { claims, blocked } = observedClaims()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const holder = claims.withEmailOperation(f.newEmail, async () => {
    entered.resolve()
    await release.promise
  })
  await entered.promise
  const confirming = new CustomerEmailChangeService({
    repository: new CustomerEmailChangeRepository(database.db), claims,
    audit: new AuditService(new AuditRepository(database.db)), secret: config.betterAuthSecret, emailSender,
  }).confirm(f.input).then(() => 'changed', (error: Error) => error.message)
  await blocked.promise
  await database.db.delete(session).where(eq(session.id, f.sessionId))
  release.resolve()
  await holder
  expect(await confirming).toBe('AUTHENTICATION_REQUIRED')
  const after = await f.read()
  expect(after.user.email).toBe(f.oldEmail)
  expect(after.pending).not.toBeNull()
  expect(after.newClaim).toBeNull()
})

it('reacquires the replacement email lock if the pending request changes while waiting', async () => {
  const f = await confirmationFixture()
  const { claims, blocked } = observedClaims()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const holder = claims.withEmailOperation(f.newEmail, async () => {
    entered.resolve()
    await release.promise
  })
  await entered.promise
  const confirming = new CustomerEmailChangeService({
    repository: new CustomerEmailChangeRepository(database.db), claims,
    audit: new AuditService(new AuditRepository(database.db)), secret: config.betterAuthSecret, emailSender,
  }).confirm(f.input).then(() => 'changed', (error: Error) => error.message)
  await blocked.promise
  const replacement = `${f.userId}@replacement.example.com`
  await claims.withEmailOperation(replacement, () => database.db.transaction((tx) =>
    new CustomerEmailChangeRepository(database.db).upsertPending(tx, {
      userId: f.userId, newEmail: replacement,
      codeDigest: digestEmailChangeCode(config.betterAuthSecret, f.userId, '87654321'),
      expiresAt: new Date(Date.now() + 600_000), failedAttempts: 0,
    })))
  release.resolve()
  await holder
  expect(await confirming).toBe('EMAIL_CHANGE_CODE_INVALID')
  expect((await f.read()).pending?.newEmail).toBe(replacement)
  expect(await service.confirm({ ...f.input, code: '87654321' })).toEqual({ changed: true })
  expect((await f.read()).user.email).toBe(replacement)
})

it('rejects staff sessions at the confirmation route', async () => {
  await database.db.update(user).set({ accountType: 'staff', role: 'support', emailVerified: true, staffActivatedAt: new Date() }).where(eq(user.id, customerId))
  await database.db.update(session).set({ lastActivityAt: new Date(), absoluteExpiresAt: new Date(Date.now() + 3_600_000) }).where(eq(session.userId, customerId))
  try {
    const response = await app.handle(new Request('http://localhost/api/v1/customer/email-change/confirm', {
      method: 'POST', headers: { cookie, origin: config.storefrontUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ code: '01234567' }),
    }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'CUSTOMER_ACCOUNT_REQUIRED', message: 'Customer account required' })
  } finally {
    await database.db.update(user).set({ accountType: 'customer', role: 'customer', emailVerified: false, staffActivatedAt: null }).where(eq(user.id, customerId))
    await database.db.update(session).set({ lastActivityAt: null, absoluteExpiresAt: null }).where(eq(session.userId, customerId))
  }
})

it('accepts an unverified customer through the route and invalidates their cookie after success', async () => {
  await database.db.delete(applicationRateLimit)
  await service.request({ userId: customerId,
    sessionId: (await database.db.select().from(session).where(eq(session.userId, customerId)))[0]!.id,
    newEmail: 'confirmed@example.com', currentPassword: 'correct horse battery staple',
    clientIp: '127.0.0.1', requestId: 'route-success',
  })
  const confirm = () => app.handle(new Request('http://localhost/api/v1/customer/email-change/confirm', {
    method: 'POST', headers: { cookie, origin: config.storefrontUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ code: '01234567' }),
  }))
  const response = await confirm()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ changed: true })
  expect((await confirm()).status).toBe(401)
})
