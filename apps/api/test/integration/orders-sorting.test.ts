import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { commerceOrder, inventoryReservation, payment, warehouse } from '../../src/database/schema'
import { listOrderDetails } from '../../src/modules/orders/repository'
import type { OrderSort } from '../../src/modules/orders/types'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

type OrderStatus = typeof commerceOrder.$inferSelect['status']

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

async function insertOrder(orderNumber: string, recipientName: string, totalSatang: number, createdAt: string, status: OrderStatus = 'placed') {
  const [mainWarehouse] = await database.db.select({ id: warehouse.id }).from(warehouse)
    .where(eq(warehouse.code, 'MAIN'))
  if (!mainWarehouse) throw new Error('Expected MAIN warehouse')
  const id = crypto.randomUUID()
  const reservationId = crypto.randomUUID()
  const created = new Date(createdAt)
  await database.db.insert(inventoryReservation).values({
    id: reservationId,
    warehouseId: mainWarehouse.id,
    status: 'confirmed',
    createdAt: created,
    expiresAt: new Date(created.getTime() + 86_400_000),
    completedAt: created,
    actorId: 'orders-sorting-test',
  })
  await database.db.insert(commerceOrder).values({
    id,
    orderNumber,
    customerId: null,
    guestAccessTokenHash: 'a'.repeat(64),
    guestAccessTokenNonce: `sorting-${id}`,
    guestAccessTokenVersion: 1,
    contactEmail: 'sorting@example.test',
    contactPhone: '081-234-5678',
    recipientName,
    addressLine1: '1 Main Road',
    subdistrict: 'Talat Noi',
    district: 'Samphanthawong',
    province: 'Bangkok',
    postalCode: '10100',
    billingName: recipientName,
    billingPhone: '081-234-5678',
    billingAddressLine1: '1 Main Road',
    billingSubdistrict: 'Talat Noi',
    billingDistrict: 'Samphanthawong',
    billingProvince: 'Bangkok',
    billingPostalCode: '10100',
    subtotalSatang: totalSatang,
    shippingSatang: 0,
    totalSatang,
    status,
    reservationId,
    quoteFingerprint: 'b'.repeat(64),
    createdAt: created,
    updatedAt: created,
  })
  await database.db.insert(payment).values({ orderId: id, method: 'cod', provider: 'cod', amountSatang: totalSatang })
}

async function readAll(sort: OrderSort | undefined, limit = 2) {
  const numbers: string[] = []
  let cursor: string | undefined
  do {
    const page = await database.db.transaction((tx) => listOrderDetails(tx, { cursor, limit, sort }))
    numbers.push(...page.items.map((order) => order.orderNumber))
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return numbers
}

describe('staff order sorting', () => {
  beforeEach(async () => {
    await insertOrder('SN-0001', 'Malee', 3_000, '2026-10-01T00:00:00.000Z', 'delivered')
    await insertOrder('SN-0002', 'Anan', 1_000, '2026-10-02T00:00:00.000Z', 'placed')
    await insertOrder('SN-0003', 'Chai', 3_000, '2026-10-03T00:00:00.000Z', 'cancelled')
    await insertOrder('SN-0004', 'Busaba', 5_000, '2026-10-04T00:00:00.000Z', 'packed')
    await insertOrder('SN-0005', 'Anan', 2_000, '2026-10-05T00:00:00.000Z', 'placed')
  })

  it('keeps newest-first as the default across pages', async () => {
    expect(await readAll(undefined)).toEqual(['SN-0005', 'SN-0004', 'SN-0003', 'SN-0002', 'SN-0001'])
  })

  it('sorts every page by the requested field, including ties', async () => {
    const totals = await readAll({ field: 'totalSatang', direction: 'desc' })
    expect(totals[0]).toBe('SN-0004')
    expect(totals.slice(1, 3).sort()).toEqual(['SN-0001', 'SN-0003'])
    expect(totals.slice(3)).toEqual(['SN-0005', 'SN-0002'])

    expect(await readAll({ field: 'totalSatang', direction: 'asc' }, 1)).toEqual(
      [...totals].reverse(),
    )
    expect(await readAll({ field: 'orderNumber', direction: 'asc' })).toEqual(['SN-0001', 'SN-0002', 'SN-0003', 'SN-0004', 'SN-0005'])
    expect(await readAll({ field: 'createdAt', direction: 'asc' })).toEqual(['SN-0001', 'SN-0002', 'SN-0003', 'SN-0004', 'SN-0005'])

    const names = await readAll({ field: 'recipientName', direction: 'asc' })
    expect(names.slice(0, 2).sort()).toEqual(['SN-0002', 'SN-0005'])
    expect(names.slice(2)).toEqual(['SN-0004', 'SN-0003', 'SN-0001'])
  })

  it('pages through orders created within the same millisecond in both directions', async () => {
    await resetTestDatabase(database)
    await migrateTestDatabase(database)
    for (const [index, number] of ['SN-1001', 'SN-1002', 'SN-1003'].entries()) {
      await insertOrder(number, 'Same Millisecond', 1_000, '2026-10-01T00:00:00.000Z')
      await database.db.execute(sql`
        update commerce_order set created_at = ${`2026-10-01T00:00:00.12345${index}Z`}::timestamptz
        where order_number = ${number}
      `)
    }
    expect(await readAll({ field: 'createdAt', direction: 'asc' }, 1)).toEqual(['SN-1001', 'SN-1002', 'SN-1003'])
    expect(await readAll(undefined, 1)).toEqual(['SN-1003', 'SN-1002', 'SN-1001'])
  })

  it('rejects a cursor from a different sort', async () => {
    const page = await database.db.transaction((tx) => listOrderDetails(tx, {
      limit: 2, sort: { field: 'totalSatang', direction: 'desc' },
    }))
    expect(page.nextCursor).toBeTruthy()
    await expect(database.db.transaction((tx) => listOrderDetails(tx, {
      limit: 2, cursor: page.nextCursor!, sort: { field: 'totalSatang', direction: 'asc' },
    }))).rejects.toThrow('INVALID_CURSOR')
    await expect(database.db.transaction((tx) => listOrderDetails(tx, {
      limit: 2, cursor: page.nextCursor!,
    }))).rejects.toThrow('INVALID_CURSOR')
  })
})
