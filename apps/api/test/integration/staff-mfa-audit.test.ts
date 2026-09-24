import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { session, user } from '../../src/database/schema'
import { DatabaseStaffMfaStore } from '../../src/modules/auth/mfa/repository'
import type { AuditService } from '../../src/modules/audit/service'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

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

describe('staff MFA audit transactions', () => {
  it('rolls back activation and session rotation when its audit insert fails', async () => {
    const now = new Date()
    await database.db.insert(user).values({
      id: 'mfa-audit-staff', name: 'Staff', email: 'mfa-audit@example.com',
      emailVerified: true, createdAt: now, updatedAt: now, accountType: 'staff', role: 'support',
    })
    await database.db.insert(session).values({
      id: 'mfa-audit-session', token: 'mfa-audit-token', userId: 'mfa-audit-staff',
      expiresAt: new Date(now.getTime() + 3_600_000), createdAt: now, updatedAt: now,
      lastActivityAt: now, absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
    })
    const audit = { record: async () => { throw new Error('AUDIT_INSERT_FAILED') } } as unknown as AuditService
    const store = new DatabaseStaffMfaStore(database.db, audit)

    await expect(store.activate('mfa-audit-staff', 'mfa-audit-token', new Date(), new Date(Date.now() + 3_600_000), {
      requestId: 'request-mfa-audit', ipAddress: '127.0.0.1', userAgent: 'test',
    })).rejects.toThrow('AUDIT_INSERT_FAILED')

    const [persistedUser] = await database.db.select().from(user).where(eq(user.id, 'mfa-audit-staff'))
    const sessions = await database.db.select().from(session).where(eq(session.userId, 'mfa-audit-staff'))
    expect(persistedUser?.staffActivatedAt).toBeNull()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.absoluteExpiresAt).toEqual(new Date(now.getTime() + 3_600_000))
  })
})
