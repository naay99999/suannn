import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from '../helpers/database'

const MAIN_WAREHOUSE_ID = '00000000-0000-4000-8000-000000000001'
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

async function insertVariant() {
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()

  await database.client.unsafe(`
    insert into product (id, slug, name, category)
    values ($1, $2, 'Inventory test product', 'fresh')
  `, [productId, `inventory-test-${productId}`])
  await database.client.unsafe(`
    insert into product_variant (id, product_id, sku, name, unit, price_satang)
    values ($1, $2, $3, 'Test variant', 'unit', 100)
  `, [variantId, productId, `INVENTORY-TEST-${variantId}`])

  return variantId
}

async function insertLot(input: {
  id?: string
  variantId: string
  lotCode: string
  onHand: number
  reserved?: number
}) {
  await database.client.unsafe(`
    insert into inventory_lot (
      id, warehouse_id, variant_id, lot_code, expiry_date,
      on_hand_quantity, reserved_quantity
    ) values ($1, $2, $3, $4, '2030-01-01', $5, $6)
  `, [
    input.id ?? crypto.randomUUID(),
    MAIN_WAREHOUSE_ID,
    input.variantId,
    input.lotCode,
    input.onHand,
    input.reserved ?? 0,
  ])
}

describe('inventory schema migration', () => {
  it('seeds the default MAIN warehouse with its stable id', async () => {
    const rows = await database.db.execute<{ id: string; code: string }>(sql`
      select id, code from warehouse where code = 'MAIN'
    `)

    expect([...rows]).toEqual([{ id: MAIN_WAREHOUSE_ID, code: 'MAIN' }])
  })

  it('defaults variant minimum shelf life to zero and enforces its range', async () => {
    const variantId = await insertVariant()
    const rows = await database.db.execute<{ min_remaining_shelf_life_days: number }>(sql`
      select min_remaining_shelf_life_days
      from product_variant
      where id = ${variantId}
    `)

    expect(rows[0]?.min_remaining_shelf_life_days).toBe(0)
    await expect((async () => {
      await database.client.unsafe(`
        update product_variant set min_remaining_shelf_life_days = -1 where id = $1
      `, [variantId])
    })()).rejects.toMatchObject({ code: '23514' })
    await expect((async () => {
      await database.client.unsafe(`
        update product_variant set min_remaining_shelf_life_days = 366 where id = $1
      `, [variantId])
    })()).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects lot codes that collide after uppercase normalization per variant', async () => {
    const variantId = await insertVariant()
    await insertLot({ variantId, lotCode: ' lot-a ', onHand: 5 })

    await expect(insertLot({ variantId, lotCode: 'LOT-A', onHand: 2 }))
      .rejects.toMatchObject({ code: '23505' })

    await insertLot({ variantId: await insertVariant(), lotCode: 'LOT-A', onHand: 2 })
  })

  it('rejects negative, over-limit, or over-reserved lot balances', async () => {
    const variantId = await insertVariant()

    await expect(insertLot({ variantId, lotCode: 'NEGATIVE', onHand: -1 }))
      .rejects.toMatchObject({ code: '23514' })
    await expect(insertLot({ variantId, lotCode: 'OVER-LIMIT', onHand: 1_000_000_001 }))
      .rejects.toMatchObject({ code: '23514' })
    await expect(insertLot({ variantId, lotCode: 'OVER-RESERVED', onHand: 1, reserved: 2 }))
      .rejects.toMatchObject({ code: '23514' })
  })

  it('rejects reservation allocations whose variant does not own the lot', async () => {
    const lotVariantId = await insertVariant()
    const otherVariantId = await insertVariant()
    const lotId = crypto.randomUUID()
    const reservationId = crypto.randomUUID()
    await insertLot({ id: lotId, variantId: lotVariantId, lotCode: 'MATCHED-LOT', onHand: 2 })
    await database.client.unsafe(`
      insert into inventory_reservation (id, warehouse_id, expires_at, actor_id)
      values ($1, $2, now() + interval '15 minutes', 'schema-test-actor')
    `, [reservationId, MAIN_WAREHOUSE_ID])

    await expect((async () => {
      await database.client.unsafe(`
        insert into inventory_reservation_allocation (
          id, reservation_id, variant_id, lot_id, quantity
        ) values ($1, $2, $3, $4, 1)
      `, [crypto.randomUUID(), reservationId, otherVariantId, lotId])
    })()).rejects.toMatchObject({ code: '23503' })
  })

  it('restricts deletion of warehouse and variant records referenced by a lot', async () => {
    const variantId = await insertVariant()
    await insertLot({ variantId, lotCode: 'REFERENCED', onHand: 1 })

    await expect((async () => {
      await database.client.unsafe(`delete from product_variant where id = $1`, [variantId])
    })()).rejects.toMatchObject({ code: '23503' })
    await expect((async () => {
      await database.client.unsafe(`delete from warehouse where id = $1`, [MAIN_WAREHOUSE_ID])
    })()).rejects.toMatchObject({ code: '23503' })
  })
})
