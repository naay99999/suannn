import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { auditLog, marketingSettings, user } from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { MarketingSettingsService } from '../../src/modules/marketing/settings'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const actorId = 'marketing-settings-owner'
const actor = { userId: actorId, auditContext: { requestId: 'request-1', ipAddress: '127.0.0.1', userAgent: null } }
let unlockDatabase: (() => Promise<void>) | undefined
let service: MarketingSettingsService

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values({
    id: actorId,
    name: 'Marketing Owner',
    email: 'marketing-settings-owner@example.test',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    role: 'owner',
    accountType: 'staff',
    staffActivatedAt: now,
  })
  service = new MarketingSettingsService(database.db, new AuditService(new AuditRepository(database.db)))
})

beforeEach(async () => {
  await database.db.delete(auditLog)
  await database.db.update(marketingSettings).set({ marginPercent: '35.0', version: 1 }).where(eq(marketingSettings.id, 1))
})

afterAll(async () => {
  await database.db.delete(auditLog)
  await database.db.update(marketingSettings).set({ updatedBy: null }).where(eq(marketingSettings.id, 1))
  await database.db.delete(user).where(eq(user.id, actorId))
  await unlockDatabase?.()
  await database.client.end()
})

describe('marketing settings', () => {
  it('returns the seeded default margin', async () => {
    expect(await service.get()).toMatchObject({ marginPercent: 35, version: 1 })
  })

  it('updates the margin, bumps the version and audits the change', async () => {
    const updated = await service.update({ marginPercent: 40.5, version: 1 }, actor)
    expect(updated).toMatchObject({ marginPercent: 40.5, version: 2 })
    expect(await service.get()).toMatchObject({ marginPercent: 40.5, version: 2 })

    const rows = await database.db.select().from(auditLog).where(eq(auditLog.action, 'marketing.settings.updated'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actorUserId: actorId, targetType: 'marketing_settings', targetId: '1' })
  })

  it('rejects a stale version without changing anything', async () => {
    await service.update({ marginPercent: 40, version: 1 }, actor)
    await expect(service.update({ marginPercent: 50, version: 1 }, actor))
      .rejects.toMatchObject({ code: 'MARKETING_SETTINGS_CONFLICT' })
    expect(await service.get()).toMatchObject({ marginPercent: 40, version: 2 })
  })

  it('rejects invalid margins', async () => {
    for (const marginPercent of [0, 0.9, 100.5, -5, 35.55, Number.NaN, 'abc' as never]) {
      await expect(service.update({ marginPercent, version: 1 }, actor))
        .rejects.toMatchObject({ code: 'INVALID_MARKETING_SETTINGS' })
    }
    expect(await service.get()).toMatchObject({ marginPercent: 35, version: 1 })
  })
})
