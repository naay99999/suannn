import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  cart,
  commerceOrder,
  discountCode,
  inventoryReservation,
  orderItem,
  product,
  productVariant,
  warehouse,
} from '../../src/database/schema'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
})

beforeEach(async () => {
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

type NewDiscount = typeof discountCode.$inferInsert
type NewOrder = typeof commerceOrder.$inferInsert

function percentCode(overrides: Partial<NewDiscount> = {}): NewDiscount {
  return { code: 'SAVE10', name: 'Save 10', kind: 'percent', percentOff: 10, ...overrides }
}

// Creates the confirmed reservation an order needs and returns the order row, not yet inserted.
async function buildOrder(overrides: Partial<NewOrder> = {}): Promise<NewOrder> {
  const [mainWarehouse] = await database.db.select({ id: warehouse.id }).from(warehouse)
    .where(eq(warehouse.code, 'MAIN'))
  if (!mainWarehouse) throw new Error('Expected MAIN warehouse')
  const id = crypto.randomUUID()
  const reservationId = crypto.randomUUID()
  const now = new Date()
  await database.db.insert(inventoryReservation).values({
    id: reservationId,
    warehouseId: mainWarehouse.id,
    status: 'confirmed',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    completedAt: now,
    actorId: 'discounts-schema-test',
  })
  return {
    id,
    orderNumber: `SN-${id.slice(0, 8)}`,
    customerId: null,
    guestAccessTokenHash: 'a'.repeat(64),
    guestAccessTokenNonce: `discounts-${id}`,
    guestAccessTokenVersion: 1,
    contactEmail: 'buyer@example.test',
    contactPhone: '081-234-5678',
    recipientName: 'Malee',
    addressLine1: '1 Main Road',
    subdistrict: 'Talat Noi',
    district: 'Samphanthawong',
    province: 'Bangkok',
    postalCode: '10100',
    billingName: 'Malee',
    billingPhone: '081-234-5678',
    billingAddressLine1: '1 Main Road',
    billingSubdistrict: 'Talat Noi',
    billingDistrict: 'Samphanthawong',
    billingProvince: 'Bangkok',
    billingPostalCode: '10100',
    subtotalSatang: 10_000,
    shippingSatang: 0,
    totalSatang: 10_000,
    reservationId,
    quoteFingerprint: 'b'.repeat(64),
    ...overrides,
  }
}

async function insertOrder(overrides: Partial<NewOrder> = {}) {
  const values = await buildOrder(overrides)
  await database.db.insert(commerceOrder).values(values)
  return values.id!
}

describe('discount_code constraints', () => {
  it('accepts one valid code per kind and applies defaults', async () => {
    await database.db.insert(discountCode).values([
      percentCode(),
      { code: 'TAKE-50', name: 'Take 50', kind: 'fixed', amountOffSatang: 5_000 },
      { code: 'SHIPFREE', name: 'Free shipping', kind: 'free_shipping' },
    ])
    const rows = await database.db.select().from(discountCode)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ active: true, version: 1, firstOrderOnly: false, eligibleCategories: [], eligibleProductIds: [], allowedEmails: [] })
  })

  it('rejects a percent code without percent_off', async () => {
    await expect(database.db.insert(discountCode).values(percentCode({ percentOff: null })).execute()).rejects.toThrow()
  })

  it('rejects mismatched kind shapes', async () => {
    const bad: NewDiscount[] = [
      percentCode({ code: 'BAD-A', amountOffSatang: 100 }),
      percentCode({ code: 'BAD-B', percentOff: 101 }),
      { code: 'BAD-C', name: 'x', kind: 'fixed' },
      { code: 'BAD-D', name: 'x', kind: 'fixed', amountOffSatang: 100, percentOff: 5 },
      { code: 'BAD-E', name: 'x', kind: 'fixed', amountOffSatang: 100, maxDiscountSatang: 100 },
      { code: 'BAD-F', name: 'x', kind: 'free_shipping', percentOff: 5 },
      { code: 'BAD-G', name: 'x', kind: 'free_shipping', amountOffSatang: 5 },
      { code: 'BAD-H', name: 'x', kind: 'free_shipping', maxDiscountSatang: 5 },
      { code: 'BAD-I', name: 'x', kind: 'bogus' as never },
    ]
    for (const values of bad) {
      await expect(database.db.insert(discountCode).values(values).execute()).rejects.toThrow()
    }
  })

  it('rejects lower-case or malformed codes', async () => {
    for (const code of ['save10', 'AB', 'HAS SPACE', 'A'.repeat(33)]) {
      await expect(database.db.insert(discountCode).values(percentCode({ code })).execute()).rejects.toThrow()
    }
  })

  it('rejects duplicate codes, bad windows, bad categories, oversized email lists and zero limits', async () => {
    await database.db.insert(discountCode).values(percentCode())
    await expect(database.db.insert(discountCode).values(percentCode()).execute()).rejects.toThrow()
    const when = new Date('2026-11-01T00:00:00Z')
    await expect(database.db.insert(discountCode).values(percentCode({ code: 'WIN-1', startsAt: when, endsAt: when })).execute()).rejects.toThrow()
    await expect(database.db.insert(discountCode).values(percentCode({ code: 'CAT-1', eligibleCategories: ['drinks'] as never })).execute()).rejects.toThrow()
    const emails = Array.from({ length: 501 }, (_, index) => `u${index}@example.test`)
    await expect(database.db.insert(discountCode).values(percentCode({ code: 'MAIL-1', allowedEmails: emails })).execute()).rejects.toThrow()
    await expect(database.db.insert(discountCode).values(percentCode({ code: 'LIM-1', usageLimit: 0 })).execute()).rejects.toThrow()
  })
})

describe('order discount snapshot', () => {
  it('accepts an order with no discount and defaults to zero', async () => {
    const id = await insertOrder()
    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, id))
    expect(order).toMatchObject({ discountSatang: 0, shippingDiscountSatang: 0, discountCodeId: null, discountCode: null, discountKind: null, discountEmail: null })
  })

  it('defaults the new columns so existing orders become zero/null without a backfill', async () => {
    const columns = await database.client.unsafe<{ column_name: string; column_default: string | null; is_nullable: string }[]>(
      `select column_name, column_default, is_nullable from information_schema.columns
       where table_name = 'commerce_order' and column_name in ('discount_satang', 'shipping_discount_satang', 'discount_code_id')`)
    const byName = Object.fromEntries(columns.map(column => [column.column_name, column]))
    expect(byName.discount_satang).toMatchObject({ column_default: '0', is_nullable: 'NO' })
    expect(byName.shipping_discount_satang).toMatchObject({ column_default: '0', is_nullable: 'NO' })
    expect(byName.discount_code_id).toMatchObject({ is_nullable: 'YES' })
  })

  it('accepts a discounted order that reconciles', async () => {
    const [code] = await database.db.insert(discountCode).values(percentCode()).returning()
    await insertOrder({
      discountCodeId: code!.id, discountCode: 'SAVE10', discountKind: 'percent', discountEmail: 'buyer@example.test',
      subtotalSatang: 10_000, discountSatang: 1_000, shippingSatang: 5_000, totalSatang: 14_000,
    })
  })

  it('rejects an order whose parts do not sum to the total', async () => {
    const values = await buildOrder({ subtotalSatang: 10_000, discountSatang: 1_000, shippingSatang: 0, totalSatang: 10_000 })
    await expect(database.db.insert(commerceOrder).values(values).execute()).rejects.toThrow()
  })

  it('rejects a discount above the subtotal and a partial discount snapshot', async () => {
    const over = await buildOrder({ subtotalSatang: 1_000, discountSatang: 2_000, shippingSatang: 0, totalSatang: -1_000 })
    await expect(database.db.insert(commerceOrder).values(over).execute()).rejects.toThrow()
    const [code] = await database.db.insert(discountCode).values(percentCode()).returning()
    const partial = await buildOrder({ discountCodeId: code!.id })
    await expect(database.db.insert(commerceOrder).values(partial).execute()).rejects.toThrow()
  })

  it('rejects updating the discount snapshot on an existing order', async () => {
    const id = await insertOrder()
    await expect(database.db.update(commerceOrder).set({ discountSatang: 1 }).where(eq(commerceOrder.id, id)).execute())
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/immutable/) } })
    await expect(database.db.update(commerceOrder).set({ shippingDiscountSatang: 1 }).where(eq(commerceOrder.id, id)).execute())
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/immutable/) } })
    await expect(database.db.update(commerceOrder).set({ discountCode: 'X' }).where(eq(commerceOrder.id, id)).execute())
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/immutable/) } })
  })

  it('defaults and protects order_item.discount_satang', async () => {
    const orderId = await insertOrder()
    const productId = crypto.randomUUID()
    const variantId = crypto.randomUUID()
    const secondVariantId = crypto.randomUUID()
    await database.db.insert(product).values({ id: productId, slug: 'mango', name: 'Mango', category: 'fresh', vatTreatment: 'exempt' })
    await database.db.insert(productVariant).values([
      { id: variantId, productId, sku: 'MANGO-1', name: '1 kg', unit: 'kg', priceSatang: 5_000 },
      { id: secondVariantId, productId, sku: 'MANGO-2', name: '2 kg', unit: 'kg', priceSatang: 5_000 },
    ])
    const [item] = await database.db.insert(orderItem).values({
      orderId, productId, variantId, sku: 'MANGO-1', productName: 'Mango', variantName: '1 kg', unit: 'kg',
      unitPriceSatang: 5_000, quantity: 2, lineTotalSatang: 10_000, vatTreatment: 'exempt',
    }).returning()
    expect(item!.discountSatang).toBe(0)
    await expect(database.db.update(orderItem).set({ discountSatang: 100 }).where(eq(orderItem.id, item!.id)).execute())
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/immutable/) } })
    await expect(database.db.insert(orderItem).values({
      orderId, productId, variantId: secondVariantId, sku: 'MANGO-2', productName: 'Mango', variantName: '2 kg', unit: 'kg',
      unitPriceSatang: 5_000, quantity: 1, lineTotalSatang: 5_000, vatTreatment: 'exempt', discountSatang: 5_001,
    }).execute()).rejects.toThrow()
  })
})

describe('discount_code references', () => {
  it('restricts deleting a code used by an order', async () => {
    const [code] = await database.db.insert(discountCode).values(percentCode()).returning()
    await insertOrder({
      discountCodeId: code!.id, discountCode: 'SAVE10', discountKind: 'percent', discountEmail: 'buyer@example.test',
      subtotalSatang: 10_000, discountSatang: 1_000, totalSatang: 9_000,
    })
    await expect(database.db.delete(discountCode).where(eq(discountCode.id, code!.id)).execute()).rejects.toThrow()
  })

  it('clears cart.discount_code_id when an unreferenced code is deleted', async () => {
    const [code] = await database.db.insert(discountCode).values(percentCode()).returning()
    const [created] = await database.db.insert(cart).values({
      guestTokenHash: 'c'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000), discountCodeId: code!.id,
    }).returning()
    expect(created!.discountCodeId).toBe(code!.id)
    await database.db.delete(discountCode).where(eq(discountCode.id, code!.id))
    const [after] = await database.db.select().from(cart).where(eq(cart.id, created!.id))
    expect(after!.discountCodeId).toBeNull()
  })

  it('indexes order usage lookups by code and normalised contact email', async () => {
    const rows = await database.client.unsafe<{ indexdef: string }[]>(
      `select indexdef from pg_indexes where tablename = 'commerce_order'`)
    const defs = rows.map(row => row.indexdef)
    expect(defs.some(def => def.includes('lower(btrim(contact_email))'))).toBe(true)
    expect(defs.some(def => def.includes('(discount_code_id, discount_email)'))).toBe(true)
  })
})
