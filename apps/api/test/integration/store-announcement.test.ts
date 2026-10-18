import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { auditLog, storeAnnouncement, user } from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { StoreAnnouncementRepository } from '../../src/modules/store-announcement/repository'
import { StoreAnnouncementService } from '../../src/modules/store-announcement/service'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const actorId = 'store-announcement-owner'
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values({
    id: actorId,
    name: 'Store Announcement Owner',
    email: 'store-announcement-owner@example.test',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    role: 'owner',
    accountType: 'staff',
    staffActivatedAt: now,
  })
})

beforeEach(async () => {
  await database.db.delete(auditLog)
  await database.db.update(storeAnnouncement).set({
    enabled: false,
    message: null,
    linkLabel: null,
    linkUrl: null,
    details: null,
    startsAt: null,
    endsAt: null,
    version: 1,
  }).where(eq(storeAnnouncement.id, 1))
})

afterAll(async () => {
  await database.db.delete(user).where(eq(user.id, actorId))
  await unlockDatabase?.()
  await database.client.end()
})

const actor = {
  userId: actorId,
  auditContext: { requestId: 'store-announcement-test', ipAddress: '127.0.0.1', userAgent: 'test' },
}

const input = {
  enabled: true,
  message: 'ลด 25% ทุเรียนหมอนทอง',
  linkLabel: 'ดูสินค้า',
  linkUrl: '/products',
  details: 'เฉพาะคำสั่งซื้อออนไลน์',
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-10-31T00:00:00.000Z',
}

function createService(now = new Date('2026-10-15T00:00:00.000Z')) {
  const audit = new AuditService(new AuditRepository(database.db))
  return new StoreAnnouncementService(new StoreAnnouncementRepository(database.db, audit), () => now)
}

describe('store announcement persistence', () => {
  it('starts disabled and hidden from the storefront', async () => {
    const service = createService()
    await expect(service.get()).resolves.toMatchObject({ enabled: false, message: null, version: 1 })
    await expect(service.getPublic()).resolves.toEqual({ announcement: null })
  })

  it('audits changed fields, increments version once per change, and publishes inside the schedule', async () => {
    const service = createService()
    const saved = await service.update(input, actor)
    const unchanged = await service.update(input, actor)
    const edited = await service.update({ ...input, message: 'ส่งฟรีทุกออเดอร์' }, actor)
    const events = await database.db.select().from(auditLog)

    expect(saved.version).toBe(2)
    expect(unchanged.version).toBe(2)
    expect(edited.version).toBe(3)
    expect(events.map(({ action, targetType, metadata }) => ({ action, targetType, metadata }))).toEqual([
      {
        action: 'settings.store-announcement-updated',
        targetType: 'store_announcement',
        metadata: { fields: ['enabled', 'message', 'linkLabel', 'linkUrl', 'details', 'startsAt', 'endsAt'] },
      },
      {
        action: 'settings.store-announcement-updated',
        targetType: 'store_announcement',
        metadata: { fields: ['message'] },
      },
    ])
    await expect(service.getPublic()).resolves.toEqual({
      announcement: { message: 'ส่งฟรีทุกออเดอร์', linkLabel: 'ดูสินค้า', linkUrl: '/products', details: 'เฉพาะคำสั่งซื้อออนไลน์' },
    })
    await expect(createService(new Date('2026-11-01T00:00:00.000Z')).getPublic()).resolves.toEqual({ announcement: null })
  })

  it('rolls back the change when the audit insert fails', async () => {
    const failing = new StoreAnnouncementService(new StoreAnnouncementRepository(database.db, {
      record: async () => { throw new Error('AUDIT_INSERT_FAILED') },
    } as unknown as AuditService))
    await expect(failing.update(input, actor)).rejects.toThrow('AUDIT_INSERT_FAILED')
    await expect(createService().get()).resolves.toMatchObject({ enabled: false, version: 1 })
  })
})
