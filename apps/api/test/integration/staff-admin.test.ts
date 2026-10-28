import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import { auditLog, session, user } from '../../src/database/schema'
import { createRequestContextPlugin } from '../../src/plugins/request-context'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'
import { createAuthPlugin } from '../../src/plugins/auth'
import { createAuth } from '../../src/plugins/auth/auth'
import { createStaffModule } from '../../src/modules/auth/staff'
import type { RateLimiter } from '../../src/modules/rate-limit/service'
import { testEnv } from '../fixtures'
import { databaseOwnerRecovery, recoverOwnerPassword } from '../../src/cli/recover-owner-password'
import { FakeEmailSender } from '../helpers/fakes'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { StaffRepository } from '../../src/modules/auth/staff/repository'
import { StaffService } from '../../src/modules/auth/staff/service'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from '../helpers/database'

const owner = { id: 'owner-1', role: 'owner' as const }
const admin = { id: 'admin-1', role: 'admin' as const }

function harness() {
  const calls: unknown[] = []
  const repository = {
    list: async () => ({ items: [], nextCursor: null }),
    getRole: async () => 'support' as const,
    listOwnSessions: async () => ({ items: [], nextCursor: null }),
    changeRole: async (...args: unknown[]) => void calls.push(['changeRole', ...args]),
    setSuspended: async (...args: unknown[]) => void calls.push(['setSuspended', ...args]),
    revokeSessions: async (...args: unknown[]) => void calls.push(['revokeSessions', ...args]),
    resetMfa: async (...args: unknown[]) => void calls.push(['resetMfa', ...args]),
    recordPasswordResetRequest: async () => ({ email: 'staff@example.com' }),
    revokeOwnSession: async (...args: unknown[]) => void calls.push(['revokeOwnSession', ...args]),
  }
  return { service: new StaffService(repository, async () => undefined), repository, calls }
}

describe('staff administration invariants', () => {
  it('denies changing your own role and rejects multiple or customer roles', async () => {
    const { service } = harness()

    await expect(service.changeRole(owner, owner.id, 'admin')).rejects.toThrow('SELF_ROLE_CHANGE')
    await expect(service.changeRole(owner, 'staff-2', 'owner,admin')).rejects.toThrow('INVALID_ROLE')
    await expect(service.changeRole(owner, 'staff-2', 'customer')).rejects.toThrow('INVALID_ROLE')
  })

  it('allows only an owner to assign owner and delegates locked owner invariants', async () => {
    const { service, calls } = harness()

    await expect(service.changeRole(admin, 'staff-2', 'owner')).rejects.toThrow('OWNER_REQUIRED')
    await service.changeRole(owner, 'staff-2', 'owner')

    expect(calls).toEqual([['changeRole', owner, 'staff-2', 'owner']])
  })

  it('prevents admins from acting on owners for suspension and MFA reset', async () => {
    const repository = {
      ...harness().repository,
      getRole: async () => 'owner' as const,
    }
    const service = new StaffService(repository, async () => undefined)

    await expect(service.suspend(admin, 'owner-1', 'incident')).rejects.toThrow('OWNER_REQUIRED')
    await expect(service.resetMfa(admin, 'owner-1')).rejects.toThrow('OWNER_REQUIRED')
  })

  it('revokes sessions through every security-sensitive transition', async () => {
    const { service, calls } = harness()

    await service.changeRole(owner, 'staff-2', 'support')
    await service.suspend(owner, 'staff-2', 'incident')
    await service.resetMfa(owner, 'staff-2')

    expect(calls.map((call) => (call as unknown[])[0])).toEqual([
      'changeRole',
      'setSuspended',
      'resetMfa',
    ])
  })
})

describe('concurrent owner invariant', () => {
  const database = createTestDatabase()
  let unlock: (() => Promise<void>) | undefined

  beforeAll(async () => {
    unlock = await lockTestDatabase(database)
    await resetTestDatabase(database)
    await migrateTestDatabase(database)
  })

  afterAll(async () => {
    await resetTestDatabase(database)
    await unlock?.()
    await database.client.end()
  })

  it('allows only one of two owners to be suspended concurrently', async () => {
    const createdAt = new Date('2026-09-22T00:00:00Z')
    await database.db.insert(user).values([
      {
        id: 'owner-1',
        name: 'Owner One',
        email: 'owner-1@example.com',
        emailVerified: true,
        createdAt,
        updatedAt: createdAt,
        accountType: 'staff',
        role: 'owner',
        staffActivatedAt: createdAt,
        banned: false,
      },
      {
        id: 'owner-2',
        name: 'Owner Two',
        email: 'owner-2@example.com',
        emailVerified: true,
        createdAt,
        updatedAt: createdAt,
        accountType: 'staff',
        role: 'owner',
        staffActivatedAt: createdAt,
        banned: false,
      },
    ])
    const audit = new AuditService(new AuditRepository(database.db))
    const first = new StaffRepository(database.db, audit)
    const second = new StaffRepository(database.db, audit)

    const results = await Promise.allSettled([
      first.setSuspended(owner, 'owner-1', true, 'test'),
      second.setSuspended({ id: 'owner-2', role: 'owner' }, 'owner-2', true, 'test'),
    ])
    const activeOwners = await database.db.select({ count: sql<number>`count(*)::int` })
      .from(user).where(and(
        eq(user.accountType, 'staff'),
        eq(user.role, 'owner'),
        eq(user.banned, false),
      ))

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(activeOwners[0]?.count).toBe(1)
  })

  it('enforces owner targeting inside the transaction boundary', async () => {
    const audit = new AuditService(new AuditRepository(database.db))
    const repository = new StaffRepository(database.db, audit)

    await expect(repository.resetMfa(admin, 'owner-2')).rejects.toThrow('OWNER_REQUIRED')
  })
})

describe('admin-issued staff password reset', () => {
  const database = createTestDatabase()
  const config = loadConfig({ ...testEnv, DATABASE_URL: database.url })
  const emailSender = new FakeEmailSender()
  const backgroundTasks: Promise<unknown>[] = []
  const staffAuth = createAuth(config, database.db, {
    emailSender,
    runInBackground: (task) => void backgroundTasks.push(task),
    staffMfaRequired: async () => false,
  }, 'staff')
  const customerAuth = createAuth(config, database.db, {
    emailSender,
    runInBackground: (task) => void backgroundTasks.push(task),
  })
  const audit = new AuditService(new AuditRepository(database.db))
  const service = new StaffService(new StaffRepository(database.db, audit), async (email) => {
    await staffAuth.api.requestPasswordReset({
      body: { email, redirectTo: new URL('/reset-password', config.adminUrl).toString() },
    })
  })
  const limiter = {
    consume: async () => ({ allowed: true, remaining: 4, retryAfterSeconds: 60, resetAt: new Date() }),
  } as unknown as RateLimiter
  const app = new Elysia()
    .use(createRequestContextPlugin(config))
    .use(createErrorHandlingPlugin())
    .use(createAuthPlugin(staffAuth, 'staff', {
      identityReservations: { findState: async () => 'staff' },
      staffMfaRequired: async () => false,
    }))
    .use(createStaffModule(config, staffAuth, service, limiter))
  const password = 'correct horse battery staple'
  const newPassword = 'a brand new passphrase 2026'
  const ids: Record<string, string> = {}
  let unlock: (() => Promise<void>) | undefined

  async function createStaff(key: string, role: 'owner' | 'admin' | 'support') {
    const email = `${key}@reset.example.com`
    const created = await customerAuth.api.signUpEmail({ body: { name: key, email, password } })
    await database.db.update(user).set({
      accountType: 'staff', role, emailVerified: true, staffActivatedAt: new Date(),
    }).where(eq(user.id, created.user.id))
    ids[key] = created.user.id
    return email
  }

  async function signIn(email: string, pass = password) {
    const response = await app.handle(new Request('http://localhost/api/v1/staff-auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: config.adminUrl, 'sec-fetch-site': 'same-site' },
      body: JSON.stringify({ email, password: pass }),
    }))
    const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
    return { response, cookie }
  }

  function requestReset(targetId: string, cookie: string) {
    return app.handle(new Request(`http://localhost/api/v1/staff/${targetId}/password-reset`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', origin: config.adminUrl, 'sec-fetch-site': 'same-site', cookie,
      },
      body: '{}',
    }))
  }

  beforeAll(async () => {
    unlock = await lockTestDatabase(database)
    await resetTestDatabase(database)
    await migrateTestDatabase(database)
    await createStaff('owner', 'owner')
    await createStaff('admin', 'admin')
    await createStaff('target', 'support')
    await Promise.allSettled(backgroundTasks.splice(0))
    emailSender.messages.splice(0)
  })

  afterAll(async () => {
    await Promise.allSettled(backgroundTasks)
    await resetTestDatabase(database)
    await unlock?.()
    await database.client.end()
  })

  it('refuses to let an admin target an owner and sends no email', async () => {
    const { cookie } = await signIn('admin@reset.example.com')
    const response = await requestReset(ids.owner!, cookie)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'OWNER_REQUIRED' })
    expect(emailSender.messages).toHaveLength(0)
  })

  it('reset link lets the staff user set a new password', async () => {
    const targetEmail = 'target@reset.example.com'
    const old = await signIn(targetEmail)
    expect(old.response.status).toBe(200)
    expect(await database.db.select().from(session).where(eq(session.userId, ids.target!))).toHaveLength(1)

    const { cookie } = await signIn('admin@reset.example.com')
    const response = await requestReset(ids.target!, cookie)
    await Promise.allSettled(backgroundTasks.splice(0))

    expect(response.status).toBe(200)
    expect(emailSender.messages).toHaveLength(1)
    expect(emailSender.messages[0]).toMatchObject({ to: targetEmail, template: 'staff-reset-password' })
    const audits = await database.db.select().from(auditLog).where(and(
      eq(auditLog.action, 'staff.password-reset-requested'),
      eq(auditLog.targetId, ids.target!),
    ))
    expect(audits).toHaveLength(1)
    expect(audits[0]?.actorUserId).toBe(ids.admin!)

    const url = emailSender.messages[0]!.text.match(/https?:\/\/\S+/)?.[0]
    if (!url) throw new Error('Missing reset URL')
    const link = new URL(url)
    const followed = await app.handle(new Request(`http://localhost${link.pathname}${link.search}`))
    const redirect = new URL(followed.headers.get('location') ?? '')
    const token = redirect.searchParams.get('token')
    expect(redirect.origin).toBe(config.adminUrl)
    if (!token) throw new Error('Missing reset token')

    const reset = await app.handle(new Request('http://localhost/api/v1/staff-auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: config.adminUrl, 'sec-fetch-site': 'same-site' },
      body: JSON.stringify({ newPassword, token }),
    }))
    expect(reset.status).toBe(200)

    expect(await database.db.select().from(session).where(eq(session.userId, ids.target!))).toHaveLength(0)
    expect((await signIn(targetEmail)).response.status).not.toBe(200)
    expect((await signIn(targetEmail, newPassword)).response.status).toBe(200)
  })

  it('owner recovery CLI refuses non-owners and records a null-actor audit for owners', async () => {
    const sent: string[] = []
    const recovery = databaseOwnerRecovery(database.db, audit, async (email) => void sent.push(email))

    await expect(recoverOwnerPassword(recovery, 'target@reset.example.com')).rejects.toThrow('ACTIVE_OWNER_NOT_FOUND')
    await expect(recoverOwnerPassword(recovery, 'nobody@reset.example.com')).rejects.toThrow('ACTIVE_OWNER_NOT_FOUND')
    expect(sent).toEqual([])

    const result = await recoverOwnerPassword(recovery, ' Owner@Reset.example.com ')
    expect(result).toEqual({ requested: true, ownerUserId: ids.owner! })
    expect(sent).toEqual(['owner@reset.example.com'])
    const [row] = await database.db.select().from(auditLog).where(and(
      eq(auditLog.action, 'staff.password-reset-requested'),
      eq(auditLog.targetId, ids.owner!),
    ))
    expect(row?.actorUserId).toBeNull()
  })
})
