import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import {
  auditLog,
  inventoryLot,
  inventoryOperation,
  inventoryReservation,
  inventoryReservationAllocation,
  product,
  productVariant,
  stockMovement,
  user,
  warehouse,
} from '../../src/database/schema'
import { bangkokDate } from '../../src/modules/inventory/policy'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { InventoryReservationRepository } from '../../src/modules/inventory/reservation-repository'
import { InventoryService } from '../../src/modules/inventory/service'
import { InventoryStockRepository } from '../../src/modules/inventory/stock-repository'
import type { CommandContext } from '../../src/modules/inventory/types'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const actorId = 'inventory-lifecycle-staff'
const actor: CommandContext['actor'] = {
  userId: actorId,
  auditContext: { requestId: 'inventory-lifecycle-test', ipAddress: '127.0.0.1', userAgent: 'test' },
}
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

beforeEach(async () => {
  await database.db.delete(auditLog)
  await database.db.delete(inventoryReservationAllocation)
  await database.db.delete(inventoryReservation)
  await database.db.delete(stockMovement)
  await database.db.delete(inventoryLot)
  await database.db.delete(inventoryOperation)
  await database.db.delete(productVariant)
  await database.db.delete(product)
  await database.db.delete(user)
  const now = new Date()
  await database.db.insert(user).values({
    id: actorId,
    name: 'Inventory Lifecycle Staff',
    email: 'inventory-lifecycle-staff@example.test',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    accountType: 'staff',
    role: 'admin',
  })
})

afterAll(async () => {
  await database.db.delete(auditLog)
  await database.db.delete(inventoryReservationAllocation)
  await database.db.delete(inventoryReservation)
  await database.db.delete(stockMovement)
  await database.db.delete(inventoryLot)
  await database.db.delete(inventoryOperation)
  await database.db.delete(productVariant)
  await database.db.delete(product)
  await database.db.delete(user).where(eq(user.id, actorId))
  await unlockDatabase?.()
  await database.client.end()
})

function createService() {
  return new InventoryService(
    new InventoryStockRepository(database.db),
    new InventoryReadRepository(database.db),
    new InventoryReservationRepository(database.db),
  )
}

async function seedVariant() {
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  const suffix = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId,
    slug: `inventory-lifecycle-${suffix}`,
    name: 'Inventory lifecycle product',
    category: 'fresh',
    status: 'published',
  })
  await database.db.insert(productVariant).values({
    id: variantId,
    productId,
    sku: `INVENTORY-LIFECYCLE-${suffix}`,
    name: 'Test unit',
    unit: 'unit',
    priceSatang: 100,
    salesEnabled: true,
  })
  return { productId, variantId }
}

async function mainWarehouseId() {
  const [row] = await database.db.select({ id: warehouse.id })
    .from(warehouse).where(eq(warehouse.code, 'MAIN'))
  if (!row) throw new Error('Expected default MAIN warehouse')
  return row.id
}

function futureDate(days = 30) {
  const date = new Date(`${bangkokDate(new Date())}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function seedLot(variantId: string, quantity = 5, receivedAt?: Date) {
  const suffix = crypto.randomUUID()
  return createService().receiveLot({
    warehouseId: await mainWarehouseId(),
    variantId,
    lotCode: `LIFECYCLE-${suffix.slice(0, 8)}`,
    quantity,
    expiryDate: futureDate(),
    ...(receivedAt ? { receivedAt } : {}),
  }, { actor, idempotencyKey: `receive-${suffix}` })
}

function command(idempotencyKey: string): CommandContext {
  return { actor, idempotencyKey }
}

async function reserve(variantId: string, quantity: number, key: string) {
  return createService().reserve({
    warehouseId: await mainWarehouseId(),
    lines: [{ variantId, quantity }],
  }, command(key))
}

describe('inventory reservation lifecycle', () => {
  it('confirms each allocated lot once and replays the same idempotency key', async () => {
    const { variantId } = await seedVariant()
    const olderLot = await seedLot(variantId, 2, new Date(Date.now() - 86_400_000))
    const newerLot = await seedLot(variantId, 4)
    const reservation = await reserve(variantId, 3, 'lifecycle-confirm-reserve')
    const context = command('lifecycle-confirm')

    const confirmed = await createService().confirm(reservation.id, context)
    const retry = await createService().confirm(reservation.id, context)

    expect(retry).toEqual(confirmed)
    expect(confirmed.status).toBe('confirmed')
    expect(await createService().getLot(olderLot.id)).toMatchObject({ onHandQuantity: 0, reservedQuantity: 0 })
    expect(await createService().getLot(newerLot.id)).toMatchObject({ onHandQuantity: 3, reservedQuantity: 0 })
    const movements = await database.db.select().from(stockMovement)
      .where(eq(stockMovement.operationId, (await database.db.select({ id: inventoryOperation.id })
        .from(inventoryOperation).where(eq(inventoryOperation.idempotencyKey, 'lifecycle-confirm')))[0]!.id))
    expect(movements).toHaveLength(2)
    const movementDetails = movements.map(({ lotId, quantityDelta, balanceAfter, type }) => ({
      lotId, quantityDelta, balanceAfter, type,
    })).sort((left, right) => left.lotId.localeCompare(right.lotId))
    const expectedMovements: typeof movementDetails = [
      { lotId: olderLot.id, quantityDelta: -2, balanceAfter: 0, type: 'reservation_confirm' as const },
      { lotId: newerLot.id, quantityDelta: -1, balanceAfter: 3, type: 'reservation_confirm' as const },
    ]
    expectedMovements.sort((left, right) => left.lotId.localeCompare(right.lotId))
    expect(movementDetails).toEqual(expectedMovements)
  })

  it('releases held units without a physical movement and conflicts with confirmation', async () => {
    const { variantId } = await seedVariant()
    const lot = await seedLot(variantId)
    const reservation = await reserve(variantId, 3, 'lifecycle-release-reserve')
    const context = command('lifecycle-release')

    const released = await createService().release(reservation.id, context)
    expect(await createService().release(reservation.id, context)).toEqual(released)
    await expect(createService().confirm(reservation.id, command('lifecycle-confirm-after-release')))
      .rejects.toMatchObject({ code: 'INVENTORY_STOCK_CONFLICT' })

    expect(released.status).toBe('released')
    expect(await createService().getLot(lot.id)).toMatchObject({ onHandQuantity: 5, reservedQuantity: 0 })
    expect(await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, lot.id))).toHaveLength(1)
  })

  it('expires a reservation when confirmation reaches its exact TTL boundary', async () => {
    const { variantId } = await seedVariant()
    const lot = await seedLot(variantId)
    const reservation = await reserve(variantId, 2, 'lifecycle-exact-ttl-reserve')
    await database.db.update(inventoryReservation).set({
      createdAt: sql`transaction_timestamp() - interval '15 minutes'`,
      expiresAt: sql`transaction_timestamp()`,
    }).where(eq(inventoryReservation.id, reservation.id))

    const context = command('lifecycle-exact-ttl-confirm')
    await expect(createService().confirm(reservation.id, context))
      .rejects.toMatchObject({ code: 'INVENTORY_STOCK_CONFLICT' })
    await expect(createService().confirm(reservation.id, context))
      .rejects.toMatchObject({ code: 'INVENTORY_STOCK_CONFLICT' })

    const [stored] = await database.db.select().from(inventoryReservation)
      .where(eq(inventoryReservation.id, reservation.id))
    const [operation] = await database.db.select().from(inventoryOperation)
      .where(eq(inventoryOperation.idempotencyKey, 'lifecycle-exact-ttl-confirm'))
    expect(stored?.status).toBe('expired')
    expect(operation?.httpStatus).toBe(409)
    expect(operation?.resultPayload).toMatchObject({ body: { code: 'INVENTORY_STOCK_CONFLICT' } })
    expect(await createService().getLot(lot.id)).toMatchObject({ onHandQuantity: 5, reservedQuantity: 0 })
    expect((await database.db.select().from(auditLog).where(eq(auditLog.targetId, reservation.id)))
      .filter(({ action }) => action === 'inventory.reservation-expired')).toHaveLength(1)
  })

  it('commits cancellation when catalog sales are disabled before confirmation', async () => {
    const { variantId } = await seedVariant()
    const lot = await seedLot(variantId)
    const reservation = await reserve(variantId, 2, 'lifecycle-disabled-reserve')
    await database.db.update(productVariant).set({ salesEnabled: false })
      .where(eq(productVariant.id, variantId))

    await expect(createService().confirm(reservation.id, command('lifecycle-disabled-confirm')))
      .rejects.toMatchObject({ code: 'RESERVATION_NOT_CONFIRMABLE' })

    const [stored] = await database.db.select().from(inventoryReservation)
      .where(eq(inventoryReservation.id, reservation.id))
    const [operation] = await database.db.select().from(inventoryOperation)
      .where(eq(inventoryOperation.idempotencyKey, 'lifecycle-disabled-confirm'))
    expect(stored?.status).toBe('cancelled')
    expect(operation?.httpStatus).toBe(409)
    expect(operation?.resultPayload).toMatchObject({ body: { code: 'RESERVATION_NOT_CONFIRMABLE' } })
    expect(await createService().getLot(lot.id)).toMatchObject({ onHandQuantity: 5, reservedQuantity: 0 })
  })

  it('commits cancellation when the product is archived before confirmation', async () => {
    const { productId, variantId } = await seedVariant()
    const lot = await seedLot(variantId)
    const reservation = await reserve(variantId, 2, 'lifecycle-archived-reserve')
    await database.db.update(product).set({ status: 'archived', archivedAt: new Date() })
      .where(eq(product.id, productId))

    await expect(createService().confirm(reservation.id, command('lifecycle-archived-confirm')))
      .rejects.toMatchObject({ code: 'RESERVATION_NOT_CONFIRMABLE' })

    const [stored] = await database.db.select().from(inventoryReservation)
      .where(eq(inventoryReservation.id, reservation.id))
    const [operation] = await database.db.select().from(inventoryOperation)
      .where(eq(inventoryOperation.idempotencyKey, 'lifecycle-archived-confirm'))
    expect(stored?.status).toBe('cancelled')
    expect(operation?.httpStatus).toBe(409)
    expect(await createService().getLot(lot.id)).toMatchObject({ onHandQuantity: 5, reservedQuantity: 0 })
  })

  it('commits overdue expiry before a reserve request returns a missing variant 404', async () => {
    const { variantId } = await seedVariant()
    const lot = await seedLot(variantId)
    const reservation = await reserve(variantId, 2, 'lifecycle-lazy-expiry-reserve')
    await database.db.update(inventoryReservation).set({
      createdAt: sql`transaction_timestamp() - interval '15 minutes'`,
      expiresAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where(eq(inventoryReservation.id, reservation.id))
    const missingVariantId = crypto.randomUUID()

    await expect(createService().reserve({
      warehouseId: await mainWarehouseId(),
      lines: [
        { variantId, quantity: 1 },
        { variantId: missingVariantId, quantity: 1 },
      ],
    }, command('lifecycle-reserve-missing-variant'))).rejects.toMatchObject({ code: 'VARIANT_NOT_FOUND' })

    const [stored] = await database.db.select().from(inventoryReservation)
      .where(eq(inventoryReservation.id, reservation.id))
    const [operation] = await database.db.select().from(inventoryOperation)
      .where(eq(inventoryOperation.idempotencyKey, 'lifecycle-reserve-missing-variant'))
    expect(stored?.status).toBe('expired')
    expect(operation?.httpStatus).toBe(404)
    expect(await createService().getLot(lot.id)).toMatchObject({ reservedQuantity: 0 })
  })

  it('expires holds once when confirmation races with periodic cleanup', async () => {
    const { variantId } = await seedVariant()
    const lot = await seedLot(variantId)
    const reservation = await reserve(variantId, 3, 'lifecycle-race-reserve')
    await database.db.update(inventoryReservation).set({
      createdAt: sql`transaction_timestamp() - interval '15 minutes'`,
      expiresAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where(eq(inventoryReservation.id, reservation.id))
    const service = createService()

    const [confirmOutcome, cleanupOutcome] = await Promise.allSettled([
      service.confirm(reservation.id, command('lifecycle-race-confirm')),
      service.expireDueReservations(10),
    ])

    expect(confirmOutcome.status).toBe('rejected')
    expect(cleanupOutcome.status).toBe('fulfilled')
    const [stored] = await database.db.select().from(inventoryReservation)
      .where(eq(inventoryReservation.id, reservation.id))
    expect(stored?.status).toBe('expired')
    expect(await createService().getLot(lot.id)).toMatchObject({ onHandQuantity: 5, reservedQuantity: 0 })
    expect((await database.db.select().from(auditLog).where(eq(auditLog.targetId, reservation.id)))
      .filter(({ action }) => action === 'inventory.reservation-expired')).toHaveLength(1)
  })

  it('expires only up to the requested bounded cleanup batch', async () => {
    const { variantId } = await seedVariant()
    const lots = await Promise.all([seedLot(variantId), seedLot(variantId), seedLot(variantId)])
    const reservations = await Promise.all(lots.map((_, index) => reserve(variantId, 1, `lifecycle-batch-reserve-${index}`)))
    await database.db.update(inventoryReservation).set({
      createdAt: sql`transaction_timestamp() - interval '15 minutes'`,
      expiresAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where(sql`${inventoryReservation.id} in (${sql.join(reservations.map(({ id }) => sql`${id}`), sql`, `)})`)

    const service = createService()
    expect(await service.expireDueReservations(2)).toBe(2)
    expect(await service.expireDueReservations(2)).toBe(1)
    expect(await service.expireDueReservations(2)).toBe(0)
    const stored = await database.db.select({ status: inventoryReservation.status }).from(inventoryReservation)
    expect(stored.map(({ status }) => status)).toEqual(['expired', 'expired', 'expired'])
    for (const lot of lots) expect(await createService().getLot(lot.id)).toMatchObject({ reservedQuantity: 0 })
  })
})
