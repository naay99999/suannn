import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, sql } from 'drizzle-orm'
import { user } from '../../src/database/schema'
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
    revokeOwnSession: async (...args: unknown[]) => void calls.push(['revokeOwnSession', ...args]),
  }
  return { service: new StaffService(repository), repository, calls }
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
    const service = new StaffService(repository)

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
