import { describe, expect, it } from 'bun:test'
import { assertAuditMetadata, type AuditEvent } from '../../src/modules/audit/model'
import { bangkokDate } from '../../src/modules/inventory/policy'
import { assertPublishable } from '../../src/modules/products/policy'
import type { AdminProduct, AdminVariant } from '../../src/modules/products/types'
import { buildDemoFixtures } from '../../src/cli/demo/fixtures'
import { demoId, parseDemoSeedOptions } from '../../src/cli/seed-demo'

const options = {
  now: new Date('2026-10-02T10:00:00.000Z'),
  warehouseId: '00000000-0000-4000-8000-000000000001',
  actorId: 'demo-owner',
  imageBaseUrl: 'https://assets.example.test/suannn',
}

describe('demo seed options', () => {
  const args = [
    '--database-name', 'suannn_dev',
    '--actor-email', 'owner@example.test',
    '--image-base-url', 'https://assets.example.test/images/',
  ]

  it('parses the exact named arguments and normalizes the base path', () => {
    expect(parseDemoSeedOptions(['--', ...args], 'development')).toEqual({
      databaseName: 'suannn_dev',
      actorEmail: 'owner@example.test',
      imageBaseUrl: 'https://assets.example.test/images',
    })
  })

  it('requires an explicit development or test environment', () => {
    expect(() => parseDemoSeedOptions(args, undefined)).toThrow()
    expect(() => parseDemoSeedOptions(args, 'production')).toThrow()
  })

  it('rejects missing, duplicate, unknown, and positional arguments', () => {
    expect(() => parseDemoSeedOptions(args.slice(0, -2), 'development')).toThrow()
    expect(() => parseDemoSeedOptions([...args, '--database-name', 'other'], 'development')).toThrow()
    expect(() => parseDemoSeedOptions([...args, '--force'], 'development')).toThrow()
    expect(() => parseDemoSeedOptions([...args, 'extra'], 'development')).toThrow()
  })

  it('requires an HTTPS image base without credentials, query, or fragment', () => {
    for (const imageBaseUrl of [
      'http://assets.example.test/images',
      'https://user:pass@assets.example.test/images',
      'https://assets.example.test/images?token=secret',
      'https://assets.example.test/images#fragment',
      'https://assets.example.test/images?',
      'https://assets.example.test/images#',
      'https://@assets.example.test/images',
      'not a URL',
    ]) {
      const invalidArgs = [...args]
      invalidArgs[invalidArgs.indexOf(args[5]!)] = imageBaseUrl
      expect(() => parseDemoSeedOptions(invalidArgs, 'development')).toThrow()
    }
  })
})

describe('demo seed fixtures', () => {
  it('builds the specified catalog and stock fixture with valid policy, balances, and audit metadata', () => {
    const fixtures = buildDemoFixtures(options)
    const { products, variants, lots, operations, movements, audits } = fixtures

    expect(products).toHaveLength(8)
    expect(variants).toHaveLength(12)
    expect(lots).toHaveLength(16)
    expect(operations).toHaveLength(18)
    expect(movements).toHaveLength(18)
    expect(audits).toHaveLength(48)
    expect(products.filter(({ status }) => status === 'published')).toHaveLength(6)
    expect(products.filter(({ status }) => status === 'draft')).toHaveLength(1)
    expect(products.filter(({ status }) => status === 'archived')).toHaveLength(1)
    expect(products.map(({ slug, category, status }) => [slug, category, status])).toEqual([
      ['demo-v1-product-01', 'fresh', 'published'],
      ['demo-v1-product-02', 'fresh', 'published'],
      ['demo-v1-product-03', 'fresh', 'published'],
      ['demo-v1-product-04', 'processed', 'published'],
      ['demo-v1-product-05', 'processed', 'published'],
      ['demo-v1-product-06', 'processed', 'published'],
      ['demo-v1-product-07', 'fresh', 'draft'],
      ['demo-v1-product-08', 'processed', 'archived'],
    ])
    expect(variants.map(({ sku }) => sku)).toEqual(Array.from({ length: 12 }, (_, index) =>
      `DEMO-V1-${String(index + 1).padStart(2, '0')}`))
    expect(lots.map(({ lotCode }) => lotCode)).toEqual(Array.from({ length: 16 }, (_, index) =>
      `DEMO-V1-LOT-${String(index + 1).padStart(2, '0')}`))
    expect(movements.filter(({ type }) => type === 'receipt')).toHaveLength(16)
    expect(movements.filter(({ type }) => type === 'write_off')).toHaveLength(2)
    expect(lots.every(({ reservedQuantity, reversibleQuantity }) => reservedQuantity === 0 && reversibleQuantity === 0))
      .toBe(true)

    for (const published of products.filter(({ status }) => status === 'published')) {
      const activeVariants = variants.filter(({ productId, archivedAt }) =>
        productId === published.id && archivedAt === null)
      expect(() => assertPublishable(published as AdminProduct, activeVariants as AdminVariant[])).not.toThrow()
    }

    const operationIds = new Set(operations.map(({ id }) => id!))
    expect(operationIds.size).toBe(18)
    expect(operations.map(({ id }) => id!)).toEqual(Array.from({ length: 18 }, (_, index) => demoId('operation', index + 1)))
    expect(movements.map(({ id }) => id!)).toEqual(Array.from({ length: 18 }, (_, index) => demoId('movement', index + 1)))
    expect(movements.every(({ operationId }) => operationIds.has(operationId))).toBe(true)
    for (const lot of lots) {
      const lotMovements = movements.filter(({ lotId }) => lotId === lot.id)
      expect(lotMovements.reduce((total, movement) => total + (movement.quantityDelta ?? 0), 0)).toBe(lot.onHandQuantity ?? 0)
    }
    for (const audit of audits) assertAuditMetadata(audit as AuditEvent)

    expect(bangkokDate(options.now)).toBe('2026-10-02')
    expect(lots.slice(0, 10).every(({ expiryDate }) => expiryDate === '2026-12-01')).toBe(true)
    expect(lots.slice(10, 12).every(({ expiryDate }) => expiryDate === '2026-10-01')).toBe(true)
    expect(fixtures.manifest.productIds).toEqual(products.map(({ id }) => id!))
    expect(fixtures.manifest.variantIds).toEqual(variants.map(({ id }) => id!))
    expect(fixtures.manifest.lotIds).toEqual(lots.map(({ id }) => id!))
    expect(fixtures.manifest.operationIds).toEqual(operations.map(({ id }) => id!))
    expect(fixtures.manifest.movementIds).toEqual(movements.map(({ id }) => id!))
    expect(fixtures.manifest.auditIds).toEqual(audits.map(({ id }) => id!))
  })

  it('assigns stable deterministic IDs for each manifest kind', () => {
    expect(demoId('product', 1)).toBe('d3e00000-0000-4000-8000-000000001001')
    expect(demoId('variant', 1)).toBe('d3e00000-0000-4000-8000-000000002001')
    expect(demoId('lot', 1)).toBe('d3e00000-0000-4000-8000-000000003001')
    expect(demoId('operation', 1)).toBe('d3e00000-0000-4000-8000-000000004001')
    expect(demoId('movement', 1)).toBe('d3e00000-0000-4000-8000-000000005001')
    expect(demoId('audit', 1)).toBe('d3e00000-0000-4000-8000-000000006001')
    expect(buildDemoFixtures(options)).toEqual(buildDemoFixtures(options))
    expect(() => demoId('product', 0)).toThrow()
  })
})
