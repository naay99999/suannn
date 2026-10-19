import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { count, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { auditLog, farm, mediaAsset, product, productImage, user } from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { processImage } from '../../src/modules/media/processing'
import { MediaRepository } from '../../src/modules/media/repository'
import { MediaService } from '../../src/modules/media/service'
import type { MediaActor } from '../../src/modules/media/types'
import { MediaUrls } from '../../src/modules/media/urls'
import { DomainError } from '../../src/shared/domain-error'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from '../helpers/database'
import { InMemoryMediaStorage } from '../helpers/fakes'

const database = createTestDatabase()
const actor: MediaActor = {
  userId: 'media-staff-actor',
  auditContext: { requestId: 'media-test-request', ipAddress: '127.0.0.1', userAgent: 'test' },
}
let unlockDatabase: (() => Promise<void>) | undefined

async function image(shade: number) {
  return new Uint8Array(await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: shade, g: 120, b: 60 } },
  }).jpeg().toBuffer())
}

async function clean() {
  await database.db.delete(auditLog)
  await database.db.delete(productImage)
  await database.db.delete(farm)
  await database.db.delete(product)
  await database.db.delete(mediaAsset)
}

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values({
    id: actor.userId, name: 'Media Staff', email: 'media-staff@example.test', emailVerified: true,
    createdAt: now, updatedAt: now, accountType: 'staff', role: 'catalog_manager',
  })
})

beforeEach(clean)

afterAll(async () => {
  await clean()
  await database.db.delete(user).where(eq(user.id, actor.userId))
  await unlockDatabase?.()
  await database.client.end()
})

function setup() {
  const storage = new InMemoryMediaStorage()
  const audit = new AuditService(new AuditRepository(database.db))
  const repository = new MediaRepository(database.db, audit, new MediaUrls('https://pub.test'))
  return { storage, repository, service: new MediaService(repository, storage) }
}

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (reason: unknown) => reason)
  expect(error).toBeInstanceOf(DomainError)
  return (error as DomainError).code
}

async function mediaCount() {
  const [row] = await database.db.select({ value: count() }).from(mediaAsset)
  return row?.value ?? 0
}

async function attachToProductAndFarm(mediaId: string, status: 'draft' | 'published') {
  const [p] = await database.db.insert(product).values({
    slug: `p-${status}`, name: 'Tomato', category: 'fresh', vatTreatment: 'exempt', status,
  }).returning({ id: product.id })
  await database.db.insert(productImage).values({ productId: p!.id, mediaId, displayOrder: 0 })
  const [f] = await database.db.insert(farm).values({
    slug: `f-${status}`, name: 'Farm', status, coverMediaId: mediaId,
  }).returning({ id: farm.id })
  return { productId: p!.id, farmId: f!.id }
}

describe('media library persistence', () => {
  it('uploads, stores both variants, and records audit', async () => {
    const { service, storage } = setup()
    const { item, created } = await service.upload(await image(10), 'tomato.jpg', 'Tomatoes', actor)

    expect(created).toBe(true)
    expect([...storage.objects.keys()].sort()).toEqual([
      `media/${item.id}/display.webp`, `media/${item.id}/thumb.webp`,
    ])
    expect(item.url).toBe(`https://pub.test/media/${item.id}/display.webp`)
    expect(item).toMatchObject({ alt: 'Tomatoes', originalFilename: 'tomato.jpg', usage: { products: 0, farms: 0 } })
    const rows = await database.db.select().from(auditLog).where(eq(auditLog.action, 'media.created'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ targetType: 'media', targetId: item.id, actorUserId: actor.userId })
  })

  it('returns the existing item for identical bytes', async () => {
    const { service, storage } = setup()
    const bytes = await image(20)
    const first = await service.upload(bytes, 'a.jpg', null, actor)
    const objects = storage.objects.size
    const second = await service.upload(bytes, 'b.jpg', null, actor)

    expect(second.created).toBe(false)
    expect(second.item.id).toBe(first.item.id)
    expect(storage.objects.size).toBe(objects)
    expect(await mediaCount()).toBe(1)
  })

  it('does not decode bytes that are already in the library', async () => {
    const { repository, storage } = setup()
    let processed = 0
    const service = new MediaService(repository, storage, (input) => {
      processed += 1
      return processImage(input)
    })
    const bytes = await image(25)
    const first = await service.upload(bytes, 'a.jpg', null, actor)
    const second = await service.upload(bytes, 'b.jpg', null, actor)

    expect(second).toMatchObject({ created: false, item: { id: first.item.id } })
    expect(processed).toBe(1)
  })

  it('does not insert a row when storage put fails', async () => {
    const { service, storage } = setup()
    storage.failNextPut = true
    await expect(service.upload(await image(30), 'a.jpg', null, actor)).rejects.toThrow()
    expect(await mediaCount()).toBe(0)
    expect(storage.objects.size).toBe(0)
  })

  it('lists newest first with keyset paging and q search', async () => {
    const { service } = setup()
    const a = await service.upload(await image(40), 'Alpha-Basil.jpg', null, actor)
    const b = await service.upload(await image(50), 'beta.jpg', 'Fresh mangoes', actor)
    const c = await service.upload(await image(60), 'gamma.jpg', null, actor)

    const first = await service.list({ limit: 2 })
    expect(first.items.map(item => item.id)).toEqual([c.item.id, b.item.id])
    expect(first.nextCursor).not.toBeNull()
    const second = await service.list({ limit: 2, cursor: first.nextCursor! })
    expect(second.items.map(item => item.id)).toEqual([a.item.id])
    expect(second.nextCursor).toBeNull()

    expect((await service.list({ q: 'alpha-BASIL' })).items.map(item => item.id)).toEqual([a.item.id])
    expect((await service.list({ q: 'MANGOES' })).items.map(item => item.id)).toEqual([b.item.id])
    expect((await service.list({ q: '%' })).items).toHaveLength(0)
  })

  it('reports usage counts and usedBy', async () => {
    const { service } = setup()
    const { item } = await service.upload(await image(70), 'a.jpg', 'Alt', actor)
    const ids = await attachToProductAndFarm(item.id, 'draft')

    const detail = await service.get(item.id)
    expect(detail.usage).toEqual({ products: 1, farms: 1 })
    expect(detail.usedBy.products).toEqual([{ id: ids.productId, name: 'Tomato', slug: 'p-draft' }])
    expect(detail.usedBy.farms).toEqual([{ id: ids.farmId, name: 'Farm', slot: 'cover' }])
    expect((await service.list({})).items[0]?.usage).toEqual({ products: 1, farms: 1 })
    expect(await codeOf(service.get('00000000-0000-4000-8000-000000000000'))).toBe('MEDIA_NOT_FOUND')
  })

  it('blocks delete while in use', async () => {
    const { service, storage } = setup()
    const { item } = await service.upload(await image(80), 'a.jpg', 'Alt', actor)
    await attachToProductAndFarm(item.id, 'draft')

    expect(await codeOf(service.delete(item.id, actor))).toBe('MEDIA_IN_USE')
    expect(storage.objects.size).toBe(2)
    expect(await mediaCount()).toBe(1)
  })

  it('deletes unused media and its storage objects', async () => {
    const { service, storage } = setup()
    const { item } = await service.upload(await image(90), 'a.jpg', null, actor)
    await service.delete(item.id, actor)

    expect(await mediaCount()).toBe(0)
    expect(storage.objects.size).toBe(0)
    const rows = await database.db.select().from(auditLog).where(eq(auditLog.action, 'media.deleted'))
    expect(rows).toHaveLength(1)
    expect(await codeOf(service.delete(item.id, actor))).toBe('MEDIA_NOT_FOUND')
  })

  it('maps a real foreign key violation to MEDIA_IN_USE', async () => {
    const { service } = setup()
    const { item } = await service.upload(await image(100), 'a.jpg', 'Alt', actor)
    const [p] = await database.db.insert(product).values({
      slug: 'racer', name: 'Racer', category: 'fresh', vatTreatment: 'exempt',
    }).returning({ id: product.id })
    // The usage check passes, then a concurrent attach lands before the delete statement runs.
    const original = database.db.transaction.bind(database.db)
    let attached = false
    const racing = Object.create(database.db) as typeof database.db
    racing.transaction = (async (run: Parameters<typeof original>[0], config?: Parameters<typeof original>[1]) =>
      original(async tx => {
        const realDelete = tx.delete.bind(tx)
        tx.delete = ((table: Parameters<typeof realDelete>[0]) => {
          if (!attached) {
            attached = true
            return {
              where: async () => {
                await tx.insert(productImage).values({ productId: p!.id, mediaId: item.id, displayOrder: 0 })
                return realDelete(table).where(eq(mediaAsset.id, item.id))
              },
            } as unknown as ReturnType<typeof realDelete>
          }
          return realDelete(table)
        }) as typeof tx.delete
        return run(tx)
      }, config)) as typeof original
    const audit = new AuditService(new AuditRepository(database.db))
    const raced = new MediaRepository(racing, audit, new MediaUrls('https://pub.test'))

    expect(await codeOf(raced.deleteUnused(item.id, actor))).toBe('MEDIA_IN_USE')
    expect(await mediaCount()).toBe(1)
  })

  it('rejects clearing alt on media used by a published product or farm', async () => {
    const { service } = setup()
    const used = await service.upload(await image(110), 'a.jpg', 'Alt', actor)
    const unused = await service.upload(await image(120), 'b.jpg', 'Alt', actor)
    const draftOnly = await service.upload(await image(130), 'c.jpg', 'Alt', actor)
    await attachToProductAndFarm(used.item.id, 'published')

    expect(await codeOf(service.updateAlt(used.item.id, null, actor))).toBe('MEDIA_STATE_CONFLICT')
    expect((await service.updateAlt(used.item.id, '  New alt  ', actor)).alt).toBe('New alt')
    expect((await service.updateAlt(unused.item.id, '   ', actor)).alt).toBeNull()
    expect((await service.updateAlt(draftOnly.item.id, null, actor)).alt).toBeNull()
    expect(await codeOf(service.updateAlt('00000000-0000-4000-8000-000000000000', 'x', actor))).toBe('MEDIA_NOT_FOUND')
    const rows = await database.db.select().from(auditLog).where(eq(auditLog.action, 'media.updated'))
    expect(rows).toHaveLength(3)
  })

  it('rejects upload and delete when storage is disabled', async () => {
    const { repository } = setup()
    const disabled = new MediaService(repository, null)
    expect(await codeOf(disabled.upload(await image(140), 'a.jpg', null, actor))).toBe('MEDIA_STORAGE_UNAVAILABLE')
    expect(await codeOf(disabled.delete('00000000-0000-4000-8000-000000000000', actor))).toBe('MEDIA_STORAGE_UNAVAILABLE')
  })
})
