import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { applicationSetting, session, twoFactor, user } from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { SystemSettingsRepository } from '../../src/modules/settings/repository'
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

describe('system security settings persistence', () => {
  it('defaults to required and preserves enrollments while revoking staff sessions on re-enable', async () => {
    const audit = new AuditService(new AuditRepository(database.db))
    const repository = new SystemSettingsRepository(database.db, audit)
    const now = new Date()
    await database.db.insert(user).values([
      {
        id: 'settings-owner', name: 'Owner', email: 'settings-owner@example.com',
        emailVerified: true, createdAt: now, updatedAt: now, accountType: 'staff', role: 'owner',
        staffActivatedAt: now, banned: false,
      },
      {
        id: 'settings-support', name: 'Support', email: 'settings-support@example.com',
        emailVerified: true, createdAt: now, updatedAt: now, accountType: 'staff', role: 'support',
        staffActivatedAt: now, twoFactorEnabled: true, banned: false,
      },
    ])
    await database.db.insert(twoFactor).values({
      id: 'settings-support-factor', userId: 'settings-support', secret: 'encrypted-secret',
      backupCodes: 'encrypted-backup-codes', verified: true,
    })
    await database.db.insert(session).values([
      {
        id: 'settings-owner-session', token: 'settings-owner-token', userId: 'settings-owner',
        expiresAt: new Date(now.getTime() + 3_600_000), createdAt: now, updatedAt: now,
      },
      {
        id: 'settings-support-session', token: 'settings-support-token', userId: 'settings-support',
        expiresAt: new Date(now.getTime() + 3_600_000), createdAt: now, updatedAt: now,
      },
    ])
    const auditContext = { requestId: 'settings-request', ipAddress: '127.0.0.1', userAgent: 'test' }

    expect(await repository.getStaffMfaRequired()).toBe(true)
    await repository.setStaffMfaRequired(false, 'settings-owner', auditContext)
    expect(await repository.getStaffMfaRequired()).toBe(false)
    expect(await database.db.select().from(session)).toHaveLength(2)

    await repository.setStaffMfaRequired(true, 'settings-owner', auditContext)

    expect(await repository.getStaffMfaRequired()).toBe(true)
    expect(await database.db.select().from(session)).toHaveLength(0)
    expect(await database.db.select().from(twoFactor).where(eq(twoFactor.userId, 'settings-support'))).toHaveLength(1)
    const [support] = await database.db.select().from(user).where(eq(user.id, 'settings-support'))
    const [setting] = await database.db.select().from(applicationSetting)
      .where(eq(applicationSetting.key, 'staff_mfa_required'))
    expect(support?.twoFactorEnabled).toBe(true)
    expect(setting?.booleanValue).toBe(true)
  })

  it('rolls the policy back if its audit record cannot be written', async () => {
    const now = new Date()
    await database.db.insert(user).values({
      id: 'settings-audit-owner', name: 'Audit Owner', email: 'settings-audit-owner@example.com',
      emailVerified: true, createdAt: now, updatedAt: now, accountType: 'staff', role: 'owner',
      staffActivatedAt: now, banned: false,
    })
    const repository = new SystemSettingsRepository(database.db, {
      record: async () => { throw new Error('AUDIT_INSERT_FAILED') },
    } as unknown as AuditService)
    await expect(repository.setStaffMfaRequired(false, 'settings-audit-owner', {
      requestId: 'settings-audit-failure', ipAddress: null, userAgent: null,
    })).rejects.toThrow('AUDIT_INSERT_FAILED')

    expect(await repository.getStaffMfaRequired()).toBe(true)
  })
})
