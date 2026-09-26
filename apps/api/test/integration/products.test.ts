import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { and, eq, isNull } from 'drizzle-orm'
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
