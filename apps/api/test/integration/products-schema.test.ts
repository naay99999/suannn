import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { product, productVariant } from '../../src/database/schema'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from '../helpers/database'

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

async function insertProduct(id: string, slug: string) {
  await database.db.insert(product).values({
    id,
    slug,
    name: `Product ${id}`,
    category: 'fresh',
  })
}

describe('product and variant schema constraints', () => {
  it('creates one product with two variants', async () => {
    await insertProduct('00000000-0000-4000-8000-000000000001', 'fresh-tomato')
    await database.db.insert(productVariant).values([
      {
        id: '00000000-0000-4000-8000-000000000011',
        productId: '00000000-0000-4000-8000-000000000001',
        sku: 'FRESH-TOMATO-500G',
        name: 'ถุง 500 กรัม',
        unit: 'ถุง',
        priceSatang: 4500,
        displayOrder: 0,
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        productId: '00000000-0000-4000-8000-000000000001',
        sku: 'FRESH-TOMATO-1KG',
        name: 'ถุง 1 กก.',
        unit: 'ถุง',
        priceSatang: 8000,
        displayOrder: 1,
      },
    ])

    const rows = await database.db.select().from(productVariant)
    expect(rows).toHaveLength(2)
    expect(rows.map(({ sku, productId }) => ({ sku, productId }))).toEqual([
      {
        sku: 'FRESH-TOMATO-500G',
        productId: '00000000-0000-4000-8000-000000000001',
      },
      {
        sku: 'FRESH-TOMATO-1KG',
        productId: '00000000-0000-4000-8000-000000000001',
      },
    ])
  })

  it('rejects duplicate product slugs', async () => {
    await insertProduct('00000000-0000-4000-8000-000000000002', 'unique-slug')

    await expect(insertProduct('00000000-0000-4000-8000-000000000003', 'unique-slug'))
      .rejects.toThrow()
  })

  it('rejects duplicate normalized uppercase SKUs', async () => {
    await insertProduct('00000000-0000-4000-8000-000000000004', 'sku-product-one')
    await insertProduct('00000000-0000-4000-8000-000000000005', 'sku-product-two')
    await database.db.insert(productVariant).values({
      id: '00000000-0000-4000-8000-000000000014',
      productId: '00000000-0000-4000-8000-000000000004',
      sku: 'FRESH-PEPPER-1KG',
      name: 'ถุง 1 กก.',
      unit: 'ถุง',
      priceSatang: 6500,
    })

    await expect((async () => {
      await database.db.insert(productVariant).values({
        id: '00000000-0000-4000-8000-000000000015',
        productId: '00000000-0000-4000-8000-000000000005',
        sku: 'FRESH-PEPPER-1KG',
        name: 'ถุง 1 กก.',
        unit: 'ถุง',
        priceSatang: 6500,
      })
    })()).rejects.toThrow()
  })

  it('keeps an archived SKU reserved', async () => {
    await insertProduct('00000000-0000-4000-8000-000000000006', 'archived-sku-product')
    await insertProduct('00000000-0000-4000-8000-000000000007', 'replacement-sku-product')
    await database.db.insert(productVariant).values({
      id: '00000000-0000-4000-8000-000000000016',
      productId: '00000000-0000-4000-8000-000000000006',
      sku: 'FRESH-ARCHIVED-1KG',
      name: 'ถุง 1 กก.',
      unit: 'ถุง',
      priceSatang: 6500,
      archivedAt: new Date(),
    })

    await expect((async () => {
      await database.db.insert(productVariant).values({
        id: '00000000-0000-4000-8000-000000000017',
        productId: '00000000-0000-4000-8000-000000000007',
        sku: 'FRESH-ARCHIVED-1KG',
        name: 'ถุง 1 กก.',
        unit: 'ถุง',
        priceSatang: 6500,
      })
    })()).rejects.toThrow()
  })

  it('rejects invalid status, category, and nonpositive price values', async () => {
    await expect((async () => {
      await database.client.unsafe(`
        insert into product (id, slug, name, category, status)
        values ('00000000-0000-4000-8000-000000000008', 'invalid-status', 'Invalid', 'fresh', 'hidden')
      `)
    })()).rejects.toThrow()
    await expect((async () => {
      await database.client.unsafe(`
        insert into product (id, slug, name, category)
        values ('00000000-0000-4000-8000-000000000009', 'invalid-category', 'Invalid', 'frozen')
      `)
    })()).rejects.toThrow()

    await insertProduct('00000000-0000-4000-8000-000000000010', 'nonpositive-price-product')
    await expect((async () => {
      await database.client.unsafe(`
        insert into product_variant (id, product_id, sku, name, unit, price_satang)
        values (
          '00000000-0000-4000-8000-000000000018',
          '00000000-0000-4000-8000-000000000010',
          'FRESH-ZERO-PRICE', 'ถุง 1 กก.', 'ถุง', 0
        )
      `)
    })()).rejects.toThrow()
  })

  it('restricts deletion of products referenced by variants', async () => {
    await insertProduct('00000000-0000-4000-8000-000000000019', 'referenced-product')
    await database.db.insert(productVariant).values({
      id: '00000000-0000-4000-8000-000000000020',
      productId: '00000000-0000-4000-8000-000000000019',
      sku: 'FRESH-REFERENCED-1KG',
      name: 'ถุง 1 กก.',
      unit: 'ถุง',
      priceSatang: 6500,
    })

    await expect((async () => {
      await database.db.delete(product)
        .where(eq(product.id, '00000000-0000-4000-8000-000000000019'))
    })()).rejects.toThrow()
  })
})
