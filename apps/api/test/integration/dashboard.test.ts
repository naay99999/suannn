import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { commerceOrder, inventoryReservation, warehouse } from '../../src/database/schema'
import { DashboardRepository } from '../../src/modules/dashboard'
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

async function insertOrder(createdAt: string, totalSatang: number, status: OrderStatus = 'placed') {
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
    actorId: 'dashboard-test',
  })
  await database.db.insert(commerceOrder).values({
    id,
    orderNumber: `DASH-${id.replaceAll('-', '')}`,
    customerId: null,
    guestAccessTokenHash: 'a'.repeat(64),
    guestAccessTokenNonce: `dashboard-${id}`,
    guestAccessTokenVersion: 1,
    contactEmail: 'dashboard@example.test',
    contactPhone: '081-234-5678',
    recipientName: 'Dashboard Test',
    addressLine1: '1 Main Road',
    subdistrict: 'Talat Noi',
    district: 'Samphanthawong',
    province: 'Bangkok',
    postalCode: '10100',
    billingName: 'Dashboard Test',
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
  return id
}

describe('DashboardRepository', () => {
  it('groups sales by Bangkok day and excludes unpaid and cancelled orders', async () => {
    // 23:30 UTC on Oct 11 is already Oct 12 in Bangkok.
    await insertOrder('2026-10-11T23:30:00.000Z', 1_000)
    await insertOrder('2026-10-12T05:00:00.000Z', 2_500, 'delivered')
    await insertOrder('2026-10-12T06:00:00.000Z', 9_999, 'cancelled')
    await insertOrder('2026-10-12T07:00:00.000Z', 9_999, 'pending_payment')
    // Outside the [from, to) window.
    await insertOrder('2026-10-04T16:59:59.000Z', 9_999)

    const sales = await new DashboardRepository(database.db).dailySales(
      new Date('2026-10-04T17:00:00.000Z'),
      new Date('2026-10-18T17:00:00.000Z'),
    )

    expect(sales).toEqual([{ date: '2026-10-12', orderCount: 2, revenueSatang: 3_500 }])
  })

  it('counts the open backlog and lists the newest orders first', async () => {
    await insertOrder('2026-10-10T00:00:00.000Z', 1_000, 'placed')
    await insertOrder('2026-10-11T00:00:00.000Z', 1_000, 'placed')
    await insertOrder('2026-10-12T00:00:00.000Z', 1_000, 'packed')
    await insertOrder('2026-10-13T00:00:00.000Z', 1_000, 'shipped')
    const newest = await insertOrder('2026-10-14T00:00:00.000Z', 1_000, 'pending_payment')
    const repository = new DashboardRepository(database.db)

    const backlog = await repository.backlogCounts()
    expect(Object.fromEntries(backlog.map((row) => [row.status, row.count]))).toEqual({
      placed: 2,
      packed: 1,
      pending_payment: 1,
    })

    const recent = await repository.recentOrders(2)
    expect(recent.map((order) => order.id)[0]).toBe(newest)
    expect(recent.map((order) => order.status)).toEqual(['pending_payment', 'shipped'])
  })
})
