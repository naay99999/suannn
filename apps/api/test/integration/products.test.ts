import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { auditLog, product, productVariant, user } from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { ProductRepository } from '../../src/modules/products/repository'
import { ProductService } from '../../src/modules/products/service'
import type { ProductActor } from '../../src/modules/products/types'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from '../helpers/database'

const database = createTestDatabase()
const actor: ProductActor = {
  userId: 'products-staff-actor',
  auditContext: { requestId: 'products-test-request', ipAddress: '127.0.0.1', userAgent: 'test' },
}
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values({
    id: actor.userId,
    name: 'Catalog Staff',
    email: 'products-staff@example.test',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    accountType: 'staff',
    role: 'catalog_manager',
  })
})

beforeEach(async () => {
  await database.db.delete(auditLog)
  await database.db.delete(productVariant)
  await database.db.delete(product)
})

afterAll(async () => {
  await database.db.delete(auditLog)
  await database.db.delete(productVariant)
  await database.db.delete(product)
  await database.db.delete(user).where(eq(user.id, actor.userId))
  await unlockDatabase?.()
  await database.client.end()
})

function serviceWith(audit = new AuditService(new AuditRepository(database.db))) {
  return new ProductService(new ProductRepository(database.db, audit))
}

async function createProduct(service: ProductService, slug = 'fresh-tomato') {
  return service.createProduct({
    slug,
    name: 'Fresh tomato',
    description: 'A sweet local crop.',
    category: 'fresh',
    imageUrl: 'https://images.example.test/tomato.jpg',
    imageAlt: 'Fresh tomatoes in a basket',
  }, actor)
}

async function createVariant(service: ProductService, productId: string, sku = 'FRESH-TOMATO-500G') {
  return service.createVariant(productId, {
    sku,
    name: '500 g bag',
    unit: 'bag',
    priceSatang: 4500,
  }, actor)
}

describe('product catalog write persistence', () => {
  it('creates and updates drafts with normalized inputs and immutable slug and SKU', async () => {
    const service = serviceWith()
    const created = await service.createProduct({
      slug: '  Fresh-Tomato  ', name: '  Fresh tomato  ', category: 'fresh',
    }, actor)
    const variant = await service.createVariant(created.id, {
      sku: ' fresh-tomato-500g ', name: ' 500 g bag ', unit: ' bag ', priceSatang: 4500,
    }, actor)

    expect(created).toMatchObject({ slug: 'fresh-tomato', name: 'Fresh tomato', status: 'draft' })
    expect(variant).toMatchObject({ sku: 'FRESH-TOMATO-500G', name: '500 g bag', unit: 'bag' })
    await expect(service.updateProduct(created.id, { slug: 'another-slug' } as never, actor))
      .rejects.toThrow('INVALID_PRODUCT')
    await expect(service.updateVariant(created.id, variant.id, { sku: 'OTHER-SKU' } as never, actor))
      .rejects.toThrow('INVALID_PRODUCT')
    await service.updateProduct(created.id, { name: '  Ripe tomato  ' }, actor)
    await service.updateVariant(created.id, variant.id, { name: '  1 kg bag  ' }, actor)
    const [storedProduct] = await database.db.select().from(product).where(eq(product.id, created.id))
    const [storedVariant] = await database.db.select().from(productVariant).where(eq(productVariant.id, variant.id))
    expect(storedProduct?.name).toBe('Ripe tomato')
    expect(storedProduct?.slug).toBe('fresh-tomato')
    expect(storedVariant?.name).toBe('1 kg bag')
    expect(storedVariant?.sku).toBe('FRESH-TOMATO-500G')
  })

  it('prevents normalized duplicate slugs and reserves archived normalized SKUs', async () => {
    const service = serviceWith()
    await createProduct(service)
    await expect(service.createProduct({ slug: ' FRESH-TOMATO ', name: 'Other', category: 'fresh' }, actor))
      .rejects.toThrow('PRODUCT_SLUG_CONFLICT')
    const first = await createProduct(service, 'green-tomato')
    const variant = await createVariant(service, first.id, ' tomato.500g ')
    await service.archiveVariant(first.id, variant.id, actor)
    const second = await createProduct(service, 'red-tomato')
    await expect(service.createVariant(second.id, {
      sku: 'TOMATO.500G', name: 'Bag', unit: 'bag', priceSatang: 5000,
    }, actor)).rejects.toThrow('SKU_CONFLICT')
  })

  it('publishes coming-soon products, rolls back invalid published edits, and audits lifecycle writes', async () => {
    const service = serviceWith()
    const created = await createProduct(service)
    const variant = await createVariant(service, created.id)
    const secondVariant = await createVariant(service, created.id, 'FRESH-TOMATO-1KG')
    await service.updateVariant(created.id, variant.id, { salesEnabled: false }, actor)
    await service.publishProduct(created.id, actor)

    await expect(service.updateProduct(created.id, { description: '   ' }, actor)).rejects.toThrow('INVALID_PRODUCT')
    const [unchanged] = await database.db.select().from(product).where(eq(product.id, created.id))
    expect(unchanged?.description).toBe('A sweet local crop.')
    await service.updateProduct(created.id, { name: 'Ripe tomato' }, actor)
    await service.archiveVariant(created.id, secondVariant.id, actor)
    await service.unpublishProduct(created.id, actor)
    await service.archiveProduct(created.id, actor)
    await expect(service.updateProduct(created.id, { name: 'Archived edit' }, actor))
      .rejects.toThrow('PRODUCT_STATE_CONFLICT')

    const events = await database.db.select({ action: auditLog.action, targetType: auditLog.targetType, metadata: auditLog.metadata })
      .from(auditLog)
    expect(events.map(({ action }) => action).sort()).toEqual([
      'product.archived', 'product.created', 'product.published', 'product.unpublished',
      'product.updated', 'product.variant-archived', 'product.variant-created',
      'product.variant-created', 'product.variant-updated',
    ].sort())
    expect(events.every(({ targetType }) => ['product', 'product_variant'].includes(targetType))).toBe(true)
    expect(JSON.stringify(events)).not.toContain('A sweet local crop.')
    expect(JSON.stringify(events)).not.toContain('https://images.example.test')
    expect(events.find(({ action }) => action === 'product.updated')?.metadata).toEqual({ fields: ['name'] })
    expect(events.filter(({ targetType }) => targetType === 'product_variant')
      .every(({ metadata }) => metadata.productId === created.id)).toBe(true)
  })

  it('protects published products from losing their last active variant and rejects archived edits or foreign variants', async () => {
    const service = serviceWith()
    const created = await createProduct(service)
    const first = await createVariant(service, created.id)
    const second = await createVariant(service, created.id, 'FRESH-TOMATO-1KG')
    await service.publishProduct(created.id, actor)
    await service.archiveVariant(created.id, second.id, actor)
    await expect(service.archiveVariant(created.id, first.id, actor)).rejects.toThrow('PRODUCT_STATE_CONFLICT')

    const other = await createProduct(service, 'other-product')
    await expect(service.updateVariant(other.id, first.id, { name: 'Foreign' }, actor)).rejects.toThrow('VARIANT_NOT_FOUND')
    await service.unpublishProduct(created.id, actor)
    await service.archiveVariant(created.id, first.id, actor)
    await expect(service.updateVariant(created.id, first.id, { salesEnabled: true }, actor))
      .rejects.toThrow('PRODUCT_STATE_CONFLICT')
  })

  it('rolls back the catalog mutation if its audit write fails', async () => {
    const failingAudit = { record: async () => { throw new Error('AUDIT_INSERT_FAILED') } } as unknown as AuditService
    const service = serviceWith(failingAudit)

    await expect(createProduct(service, 'audit-failure')).rejects.toThrow('AUDIT_INSERT_FAILED')
    expect(await database.db.select().from(product).where(eq(product.slug, 'audit-failure'))).toHaveLength(0)
    expect(await database.db.select().from(auditLog)).toHaveLength(0)
  })

  it('serializes publish against archival of the final active variant', async () => {
    const service = serviceWith()
    const created = await createProduct(service, 'concurrent-product')
    const variant = await createVariant(service, created.id, 'CONCURRENT-SKU')

    const results = await Promise.allSettled([
      service.publishProduct(created.id, actor),
      service.archiveVariant(created.id, variant.id, actor),
    ])
    const [storedProduct] = await database.db.select().from(product).where(eq(product.id, created.id))
    const [activeVariant] = await database.db.select({ id: productVariant.id })
      .from(productVariant)
      .where(and(eq(productVariant.productId, created.id), isNull(productVariant.archivedAt)))

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(storedProduct?.status === 'published' && activeVariant === undefined).toBe(false)
  })
})

describe('product catalog read queries', () => {
  async function seedProduct(input: {
    id: string
    slug: string
    name: string
    status: 'draft' | 'published' | 'archived'
    category?: 'fresh' | 'processed'
    englishName?: string | null
    description?: string | null
    minPrices?: number[]
    archivedVariantPrices?: number[]
    salesEnabled?: boolean
    createdAt?: Date
  }) {
    const now = input.createdAt ?? new Date('2026-01-01T00:00:00.000Z')
    await database.db.insert(product).values({
      id: input.id,
      slug: input.slug,
      name: input.name,
      englishName: input.englishName ?? null,
      description: input.description ?? 'A locally grown product.',
      category: input.category ?? 'fresh',
      originStory: 'From our farm.',
      storageInstructions: 'Keep chilled.',
      imageUrl: 'https://images.example.test/catalog.jpg',
      imageAlt: 'A product in a basket',
      status: input.status,
      createdAt: now,
      updatedAt: now,
      publishedAt: input.status === 'published' ? now : null,
      archivedAt: input.status === 'archived' ? now : null,
    })
    const variants = [
      ...(input.minPrices ?? []).map((priceSatang, index) => ({
        priceSatang,
        archivedAt: null,
        index,
      })),
      ...(input.archivedVariantPrices ?? []).map((priceSatang, index) => ({
        priceSatang,
        archivedAt: now,
        index: index + (input.minPrices?.length ?? 0),
      })),
    ]
    if (variants.length) {
      await database.db.insert(productVariant).values(variants.map(({ priceSatang, archivedAt, index }) => ({
        id: crypto.randomUUID(),
        productId: input.id,
        sku: `${input.slug.toUpperCase()}-${index}`,
        name: `Pack ${index}`,
        unit: 'pack',
        priceSatang,
        salesEnabled: input.salesEnabled ?? true,
        displayOrder: index,
        createdAt: now,
        updatedAt: now,
        archivedAt,
      })))
    }
  }

  it('keeps public reads published-only and omits management and audit fields', async () => {
    await seedProduct({ id: '10000000-0000-4000-8000-000000000001', slug: 'published-item', name: 'Published item', status: 'published', minPrices: [5000], archivedVariantPrices: [100], salesEnabled: false })
    await seedProduct({ id: '10000000-0000-4000-8000-000000000002', slug: 'draft-item', name: 'Draft item', status: 'draft', minPrices: [2000] })
    await seedProduct({ id: '10000000-0000-4000-8000-000000000003', slug: 'archived-item', name: 'Archived item', status: 'archived', minPrices: [3000], archivedVariantPrices: [2000] })

    const service = serviceWith()
    const storePage = await service.listStore({})
    const storeDetail = await service.getStoreBySlug('published-item')
    const adminPage = await service.listAdmin({})
    const adminDetail = await service.getAdminById('10000000-0000-4000-8000-000000000003')

    expect(storePage.items.map(({ slug }) => slug)).toEqual(['published-item'])
    expect(storeDetail.variants.map(({ priceSatang }) => priceSatang)).toEqual([5000])
    expect(storeDetail.variants[0]).toMatchObject({ canPurchase: false })
    expect(Object.keys(storeDetail.variants[0] ?? {})).not.toContain('archivedAt')
    const storeJson = JSON.stringify({ page: storePage, detail: storeDetail })
    expect(storeJson).not.toContain('draft-item')
    expect(storeJson).not.toContain('archived-item')
    for (const field of ['archivedAt', 'publishedAt', 'createdAt', 'updatedAt', 'status', 'salesEnabled', 'actorUserId', 'metadata']) {
      expect(storeJson).not.toContain(`"${field}"`)
    }
    expect(adminPage.items.map(({ status }) => status).sort()).toEqual(['archived', 'draft', 'published'])
    expect(adminDetail.status).toBe('archived')
    expect(adminDetail.variants?.map(({ archivedAt }) => archivedAt === null).sort()).toEqual([false, true])
  })

  it('filters store products by normalized case-insensitive text and category', async () => {
    await seedProduct({ id: '10000000-0000-4000-8000-000000000011', slug: 'banana-fresh', name: 'Sweet banana', englishName: 'Yellow fruit', status: 'published', category: 'fresh', minPrices: [700] })
    await seedProduct({ id: '10000000-0000-4000-8000-000000000012', slug: 'banana-dried', name: 'Dried banana', status: 'published', category: 'processed', minPrices: [900] })
    await seedProduct({ id: '10000000-0000-4000-8000-000000000013', slug: 'tomato-fresh', name: 'Red tomato', englishName: 'Fresh fruit', status: 'published', category: 'fresh', minPrices: [1000] })

    const service = serviceWith()
    expect((await service.listStore({ q: '  BANANA  ' })).items.map(({ slug }) => slug).sort())
      .toEqual(['banana-dried', 'banana-fresh'])
    expect((await service.listStore({ q: 'YELLOW' })).items.map(({ slug }) => slug)).toEqual(['banana-fresh'])
    expect((await service.listStore({ category: 'fresh' })).items.map(({ slug }) => slug).sort())
      .toEqual(['banana-fresh', 'tomato-fresh'])
    expect((await service.listStore({ q: 'banana', category: 'fresh' })).items.map(({ slug }) => slug))
      .toEqual(['banana-fresh'])
  })

  it('sorts by the lowest active variant price and uses product ID as a stable tie breaker', async () => {
    await seedProduct({ id: '10000000-0000-4000-8000-000000000021', slug: 'price-middle', name: 'Middle', status: 'published', minPrices: [1200] })
    await seedProduct({ id: '10000000-0000-4000-8000-000000000022', slug: 'price-tie-later', name: 'Tie later', status: 'published', minPrices: [800], archivedVariantPrices: [1] })
    await seedProduct({ id: '10000000-0000-4000-8000-000000000020', slug: 'price-tie-first', name: 'Tie first', status: 'published', minPrices: [800] })

    const service = serviceWith()
    expect((await service.listStore({ sort: 'price-asc' })).items.map(({ slug }) => slug))
      .toEqual(['price-tie-first', 'price-tie-later', 'price-middle'])
    expect((await service.listStore({ sort: 'price-desc' })).items.map(({ slug }) => slug))
      .toEqual(['price-middle', 'price-tie-first', 'price-tie-later'])
    const firstPage = await service.listStore({ sort: 'price-asc', limit: 1 })
    const secondPage = await service.listStore({ sort: 'price-asc', limit: 1, cursor: firstPage.nextCursor ?? undefined })
    expect(firstPage.items.map(({ slug }) => slug)).toEqual(['price-tie-first'])
    expect(secondPage.items.map(({ slug }) => slug)).toEqual(['price-tie-later'])
  })

  it('preserves database timestamp precision across newest cursors', async () => {
    const earlierId = '10000000-0000-4000-8000-000000000041'
    const laterId = '10000000-0000-4000-8000-000000000042'
    await seedProduct({ id: earlierId, slug: 'microsecond-earlier', name: 'Earlier', status: 'published', minPrices: [500] })
    await seedProduct({ id: laterId, slug: 'microsecond-later', name: 'Later', status: 'published', minPrices: [500] })
    await database.db.execute(sql`update product set created_at = case id
      when ${earlierId}::uuid then '2026-01-01T00:00:00.123456Z'::timestamptz
      when ${laterId}::uuid then '2026-01-01T00:00:00.123789Z'::timestamptz
      else created_at end
      where id in (${earlierId}::uuid, ${laterId}::uuid)`)

    const service = serviceWith()
    const storeFirst = await service.listStore({ limit: 1 })
    const storeSecond = await service.listStore({ limit: 1, cursor: storeFirst.nextCursor ?? undefined })
    const adminFirst = await service.listAdmin({ limit: 1 })
    const adminSecond = await service.listAdmin({ limit: 1, cursor: adminFirst.nextCursor ?? undefined })

    expect(storeFirst.items.map(({ slug }) => slug)).toEqual(['microsecond-later'])
    expect(storeSecond.items.map(({ slug }) => slug)).toEqual(['microsecond-earlier'])
    expect(adminFirst.items.map(({ slug }) => slug)).toEqual(['microsecond-later'])
    expect(adminSecond.items.map(({ slug }) => slug)).toEqual(['microsecond-earlier'])
  })

  it('uses the default and maximum page sizes and rejects bad limits and cursor reuse', async () => {
    const rows = Array.from({ length: 105 }, (_, index) => {
      const id = `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      return {
        id,
        slug: `page-item-${index + 1}`,
        name: `Page item ${index + 1}`,
        category: 'fresh' as const,
        status: 'published' as const,
        createdAt: new Date(2026, 0, 1, 0, 0, index),
        updatedAt: new Date(2026, 0, 1, 0, 0, index),
        publishedAt: new Date(2026, 0, 1, 0, 0, index),
      }
    })
    await database.db.insert(product).values(rows)
    await database.db.insert(productVariant).values(rows.map((row, index) => ({
      id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      productId: row.id,
      sku: `PAGE-${index + 1}`,
      name: 'Pack',
      unit: 'pack',
      priceSatang: index + 100,
    })))

    const service = serviceWith()
    const defaultPage = await service.listStore({})
    const maxPage = await service.listAdmin({ limit: 100 })
    expect(defaultPage.items).toHaveLength(50)
    expect(defaultPage.nextCursor).toBeString()
    expect(maxPage.items).toHaveLength(100)
    expect(maxPage.nextCursor).toBeString()
    await expect(service.listStore({ limit: 101 })).rejects.toThrow('INVALID_PRODUCT')
    await expect(service.listAdmin({ limit: 0 })).rejects.toThrow('INVALID_PRODUCT')
    await expect(service.listStore({ cursor: 'not-a-cursor' })).rejects.toThrow('INVALID_CURSOR')
    const categoryPage = await service.listStore({ category: 'fresh', limit: 1 })
    if (!categoryPage.nextCursor) throw new Error('Expected another page')
    await expect(service.listStore({ category: 'processed', limit: 1, cursor: categoryPage.nextCursor }))
      .rejects.toThrow('INVALID_CURSOR')
    const sortPage = await service.listStore({ sort: 'newest', limit: 1 })
    if (!sortPage.nextCursor) throw new Error('Expected another page')
    await expect(service.listStore({ sort: 'price-asc', limit: 1, cursor: sortPage.nextCursor }))
      .rejects.toThrow('INVALID_CURSOR')
  })

  it('hides drafts and archived products from slug detail even when their slugs are known', async () => {
    await seedProduct({ id: '10000000-0000-4000-8000-000000000031', slug: 'known-draft', name: 'Draft', status: 'draft', minPrices: [500] })
    await seedProduct({ id: '10000000-0000-4000-8000-000000000032', slug: 'known-archived', name: 'Archived', status: 'archived', minPrices: [500] })

    const service = serviceWith()
    await expect(service.getStoreBySlug('known-draft')).rejects.toThrow('PRODUCT_NOT_FOUND')
    await expect(service.getStoreBySlug('known-archived')).rejects.toThrow('PRODUCT_NOT_FOUND')
    await expect(service.getStoreBySlug('missing')).rejects.toThrow('PRODUCT_NOT_FOUND')
  })
})
