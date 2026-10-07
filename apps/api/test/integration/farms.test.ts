import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { auditLog, farm } from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { FarmRepository } from '../../src/modules/farms/repository'
import { FarmService } from '../../src/modules/farms/service'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined
const actor = { userId: 'farm-staff', auditContext: { requestId: 'farm-test', ipAddress: null, userAgent: null } }
const validFarm = {
  slug: 'suan-som-test', name: 'สวนส้มทดสอบ', farmerName: 'คุณสม', province: 'เชียงใหม่',
  summary: 'สวนผลไม้ในเชียงใหม่', story: 'เรื่องราวของสวน', growingPractices: 'วิธีปลูกของสวน',
  coverImageUrl: 'https://images.example.test/farm.jpg', coverImageAlt: 'สวนผลไม้',
}

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})
beforeEach(async () => { await database.db.delete(auditLog); await database.db.delete(farm) })
afterAll(async () => { await unlockDatabase?.(); await database.client.end() })

const service = new FarmService(new FarmRepository(database.db, new AuditService(new AuditRepository(database.db))))

describe('farm lifecycle and public visibility', () => {
  it('creates drafts, publishes complete profiles and hides them after archival', async () => {
    const draft = await service.createFarm({ slug: 'draft-farm', name: 'สวนร่าง' }, actor)
    await expect(service.publishFarm(draft.id, actor)).rejects.toThrow('INVALID_FARM')
    const created = await service.createFarm(validFarm, actor)
    expect(created.status).toBe('draft')
    await service.publishFarm(created.id, actor)
    expect((await service.getStoreBySlug(validFarm.slug)).name).toBe(validFarm.name)
    await service.archiveFarm(created.id, actor)
    await expect(service.getStoreBySlug(validFarm.slug)).rejects.toThrow('FARM_NOT_FOUND')
    await expect(service.updateFarm(created.id, { name: 'แก้ไม่ได้' }, actor)).rejects.toThrow('FARM_STATE_CONFLICT')
  })

  it('audits lifecycle transitions once and preserves state after a duplicate slug conflict', async () => {
    const created = await service.createFarm(validFarm, actor)
    await service.publishFarm(created.id, actor)
    await service.publishFarm(created.id, actor)
    expect(await database.db.select().from(auditLog).where(eq(auditLog.action, 'farm.published'))).toHaveLength(1)
    await expect(service.createFarm({ ...validFarm, slug: 'suan-som-test' }, actor)).rejects.toThrow('FARM_SLUG_CONFLICT')
    expect(await database.db.select().from(farm).where(eq(farm.slug, validFarm.slug))).toHaveLength(1)
  })

  it('returns a stable cursor page when creation timestamps tie', async () => {
    await service.createFarm({ ...validFarm, slug: 'suan-a' }, actor)
    await service.createFarm({ ...validFarm, slug: 'suan-b' }, actor)
    const first = await service.listAdmin({ limit: 1 })
    const second = await service.listAdmin({ limit: 1, cursor: first.nextCursor ?? undefined })
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id)
  })
})
