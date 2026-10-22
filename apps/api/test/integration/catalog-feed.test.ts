import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  inventoryLot,
  mediaAsset,
  product,
  productImage,
  productVariant,
  warehouse,
} from '../../src/database/schema'
import { CatalogFeedRepository } from '../../src/modules/catalog-feed/repository'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { MediaUrls } from '../../src/modules/media/urls'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined

async function clean() {
  await database.db.delete(productImage)
  await database.db.delete(inventoryLot)
  await database.db.delete(productVariant)
  await database.db.delete(product)
  await database.db.delete(mediaAsset)
}

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

beforeEach(clean)

afterAll(async () => {
  await clean()
  await unlockDatabase?.()
  await database.client.end()
})

function repository(urls = new MediaUrls(null)) {
  return new CatalogFeedRepository(database.db, new InventoryReadRepository(database.db), urls)
}

async function seedProduct(options: { name?: string, status?: 'draft' | 'published' | 'archived' } = {}) {
  const id = crypto.randomUUID()
  await database.db.insert(product).values({
    id,
    slug: `feed-${id}`,
    name: options.name ?? 'Feed product',
    category: 'fresh',
    vatTreatment: 'exempt',
    status: options.status ?? 'published',
  })
  return id
}

async function seedVariant(productId: string, options: { name?: string, salesEnabled?: boolean, archived?: boolean, displayOrder?: number } = {}) {
  const id = crypto.randomUUID()
  await database.db.insert(productVariant).values({
    id,
    productId,
    sku: `FEED-${id}`,
    name: options.name ?? 'Unit',
    unit: 'unit',
    priceSatang: 12900,
    salesEnabled: options.salesEnabled ?? true,
    displayOrder: options.displayOrder ?? 0,
    archivedAt: options.archived ? new Date() : null,
  })
  return id
}

function date(days: number) {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

async function seedLot(variantId: string, options: { expiryDate?: string, quarantined?: boolean } = {}) {
  const [main] = await database.db.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.code, 'MAIN'))
  if (!main) throw new Error('Expected MAIN warehouse')
  await database.db.insert(inventoryLot).values({
    warehouseId: main.id,
    variantId,
    lotCode: `FEED-${crypto.randomUUID().slice(0, 8)}`,
    expiryDate: options.expiryDate ?? date(30),
    quarantinedAt: options.quarantined ? new Date() : null,
    quarantineReason: options.quarantined ? 'feed test' : null,
    onHandQuantity: 1,
  })
}

describe('catalog feed repository', () => {
  it('omits draft and archived products and archived variants', async () => {
    const published = await seedProduct()
    const kept = await seedVariant(published)
    await seedVariant(published, { archived: true })
    await seedVariant(await seedProduct({ status: 'draft' }))
    await seedVariant(await seedProduct({ status: 'archived' }))

    const rows = await repository().listVariantRows()
    expect(rows.map(({ variantId }) => variantId)).toEqual([kept])
  })

  it('includes a sales-disabled variant as not sellable', async () => {
    const variantId = await seedVariant(await seedProduct(), { salesEnabled: false })
    await seedLot(variantId)
    const [row] = await repository().listVariantRows()
    expect(row).toMatchObject({ variantId, salesEnabled: false, sellable: false })
  })

  it('marks only the variant with a received lot as sellable, in display order', async () => {
    const productId = await seedProduct()
    const second = await seedVariant(productId, { name: 'B', displayOrder: 2 })
    const first = await seedVariant(productId, { name: 'A', displayOrder: 1 })
    await seedLot(first)
    const rows = await repository().listVariantRows()
    expect(rows.map(({ variantId, sellable }) => [variantId, sellable])).toEqual([[first, true], [second, false]])
  })

  it('treats expired and quarantined lots as not sellable', async () => {
    const productId = await seedProduct()
    const expired = await seedVariant(productId, { displayOrder: 1 })
    const quarantined = await seedVariant(productId, { displayOrder: 2 })
    await seedLot(expired, { expiryDate: date(-1) })
    await seedLot(quarantined, { quarantined: true })
    const rows = await repository().listVariantRows()
    expect(rows.map(({ sellable }) => sellable)).toEqual([false, false])
  })

  it('returns gallery images in order when media is configured and none otherwise', async () => {
    const productId = await seedProduct()
    await seedVariant(productId)
    const mediaIds = [crypto.randomUUID(), crypto.randomUUID()]
    for (const [index, id] of mediaIds.entries()) {
      await database.db.insert(mediaAsset).values({
        id,
        storageKey: `media/${id}`,
        originalFilename: `feed-${index}.jpg`,
        contentHash: `${index}`.repeat(64),
        alt: `alt ${index}`,
        width: 100,
        height: 100,
        byteSize: 10,
        thumbByteSize: 5,
      })
    }
    await database.db.insert(productImage).values([
      { productId, mediaId: mediaIds[1]!, displayOrder: 0 },
      { productId, mediaId: mediaIds[0]!, displayOrder: 1 },
    ])

    const [withMedia] = await repository(new MediaUrls('https://media.example.test')).listVariantRows()
    expect(withMedia?.images).toEqual([
      { url: `https://media.example.test/media/${mediaIds[1]}/display.webp`, alt: 'alt 1' },
      { url: `https://media.example.test/media/${mediaIds[0]}/display.webp`, alt: 'alt 0' },
    ])
    const [without] = await repository().listVariantRows()
    expect(without?.images).toEqual([])
  })
})
