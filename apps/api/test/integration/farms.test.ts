import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { auditLog, farm, user } from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { FarmRepository } from '../../src/modules/farms/repository'
import { FarmService } from '../../src/modules/farms/service'
import { MediaUrls } from '../../src/modules/media/urls'
import { insertMediaAsset } from '../fixtures'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined
const actor = { userId: 'farm-staff', auditContext: { requestId: 'farm-test', ipAddress: null, userAgent: null } }
const validFarm = {
  slug: 'suan-som-test', name: 'สวนส้มทดสอบ', farmerName: 'คุณสม', province: 'เชียงใหม่',
  summary: 'สวนผลไม้ในเชียงใหม่', story: 'เรื่องราวของสวน', growingPractices: 'วิธีปลูกของสวน',
}

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values({
    id: actor.userId, name: 'Catalog Staff', email: 'farm-staff@example.test', emailVerified: true,
    createdAt: now, updatedAt: now, accountType: 'staff', role: 'catalog_manager',
  })
})
beforeEach(async () => { await database.db.delete(auditLog); await database.db.delete(farm) })
afterAll(async () => { await unlockDatabase?.(); await database.client.end() })

const service = new FarmService(new FarmRepository(
  database.db, new AuditService(new AuditRepository(database.db)), new MediaUrls('https://media.example.test'),
))
const coverOf = async (alt: string | null = 'สวนผลไม้') => insertMediaAsset(database.db, { alt })
const withCover = async () => ({ ...validFarm, coverMediaId: await coverOf() })

describe('farm lifecycle and public visibility', () => {
  it('creates drafts, publishes complete profiles and hides them after archival', async () => {
    const draft = await service.createFarm({ slug: 'draft-farm', name: 'สวนร่าง' }, actor)
    await expect(service.publishFarm(draft.id, actor)).rejects.toThrow('INVALID_FARM')
    const created = await service.createFarm(await withCover(), actor)
    expect(created.status).toBe('draft')
    await service.publishFarm(created.id, actor)
    expect((await service.getStoreBySlug(validFarm.slug)).name).toBe(validFarm.name)
    await service.archiveFarm(created.id, actor)
    await expect(service.getStoreBySlug(validFarm.slug)).rejects.toThrow('FARM_NOT_FOUND')
    await expect(service.updateFarm(created.id, { name: 'แก้ไม่ได้' }, actor)).rejects.toThrow('FARM_STATE_CONFLICT')
  })

  it('audits lifecycle transitions once and preserves state after a duplicate slug conflict', async () => {
    const created = await service.createFarm(await withCover(), actor)
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

  it('sets and clears cover and portrait media', async () => {
    const [cover, portrait] = [await coverOf('ปก'), await coverOf('คนสวน')]
    const created = await service.createFarm({ slug: 'media-farm', name: 'สวนภาพ', coverMediaId: cover }, actor)
    expect(created.coverImage?.id).toBe(cover)
    expect(created.coverImage?.url).toBe(`https://media.example.test/media/${cover}/display.webp`)
    expect(created.portraitImage).toBeNull()
    const updated = await service.updateFarm(created.id, { portraitMediaId: portrait }, actor)
    expect(updated.coverImage?.id).toBe(cover)
    expect(updated.portraitImage?.id).toBe(portrait)
    const cleared = await service.updateFarm(created.id, { coverMediaId: null, portraitMediaId: null }, actor)
    expect(cleared.coverImage).toBeNull()
    expect(cleared.portraitImage).toBeNull()
  })

  it('rejects unknown media IDs on create and update', async () => {
    const unknown = '00000000-0000-4000-8000-0000000000ff'
    await expect(service.createFarm({ slug: 'bad-media', name: 'สวน', coverMediaId: unknown }, actor)).rejects.toThrow('INVALID_FARM')
    const created = await service.createFarm({ slug: 'ok-media', name: 'สวน' }, actor)
    await expect(service.updateFarm(created.id, { portraitMediaId: unknown }, actor)).rejects.toThrow('INVALID_FARM')
    expect(await database.db.select().from(farm).where(eq(farm.slug, 'bad-media'))).toHaveLength(0)
  })

  it('publishing requires a cover with alt and keeps published farms publishable', async () => {
    const noAlt = await service.createFarm({ ...validFarm, coverMediaId: await coverOf(null) }, actor)
    await expect(service.publishFarm(noAlt.id, actor)).rejects.toThrow('INVALID_FARM')
    const created = await service.createFarm({ ...validFarm, slug: 'alt-farm', coverMediaId: await coverOf('มีคำอธิบาย') }, actor)
    await service.publishFarm(created.id, actor)
    await expect(service.updateFarm(created.id, { coverMediaId: null }, actor)).rejects.toThrow('INVALID_FARM')
    await expect(service.updateFarm(created.id, { coverMediaId: await coverOf(null) }, actor)).rejects.toThrow('INVALID_FARM')
    await expect(service.updateFarm(created.id, { portraitMediaId: await coverOf(null) }, actor)).rejects.toThrow('INVALID_FARM')
    expect((await service.getAdminById(created.id)).coverImage?.alt).toBe('มีคำอธิบาย')
  })

  it('archive clears both media slots', async () => {
    const created = await service.createFarm({
      ...validFarm, slug: 'archive-farm', coverMediaId: await coverOf(), portraitMediaId: await coverOf('คนสวน'),
    }, actor)
    await service.archiveFarm(created.id, actor)
    const [row] = await database.db.select().from(farm).where(eq(farm.id, created.id))
    expect(row?.coverMediaId).toBeNull()
    expect(row?.portraitMediaId).toBeNull()
    expect((await service.getAdminById(created.id)).coverImage).toBeNull()
  })

  it('exposes cover and portrait images on public farm reads', async () => {
    const created = await service.createFarm({
      ...validFarm, slug: 'public-farm', coverMediaId: await coverOf('ปก'), portraitMediaId: await coverOf('คนสวน'),
    }, actor)
    await service.publishFarm(created.id, actor)
    expect((await service.getStoreBySlug('public-farm')).portraitImage?.alt).toBe('คนสวน')
    expect((await service.listStore({})).items[0]?.coverImage?.alt).toBe('ปก')
  })
})
