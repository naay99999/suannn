import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
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
import type { CommandContext, ReserveInput } from '../../src/modules/inventory/types'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const actorId = 'inventory-reservation-staff'
const actor: CommandContext['actor'] = {
  userId: actorId,
  auditContext: { requestId: 'inventory-reservation-test', ipAddress: '127.0.0.1', userAgent: 'test' },
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
    name: 'Inventory Staff',
    email: 'inventory-reservation-staff@example.test',
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

async function seedVariants(count: number, minRemainingShelfLifeDays = 0) {
  const ids: string[] = []
  const suffix = crypto.randomUUID()
  for (let index = 0; index < count; index++) {
    const productId = crypto.randomUUID()
    const variantId = crypto.randomUUID()
    await database.db.insert(product).values({
      id: productId,
      slug: `inventory-reservation-${suffix}-${index}`,
      name: `Reservation product ${index}`,
      category: 'fresh',
      status: 'published',
    })
    await database.db.insert(productVariant).values({
      id: variantId,
      productId,
      sku: `INVENTORY-RESERVATION-${suffix}-${index}`,
      name: 'Test unit',
      unit: 'unit',
      priceSatang: 100,
      salesEnabled: true,
      minRemainingShelfLifeDays,
    })
    ids.push(variantId)
  }
  return ids
}

async function mainWarehouseId() {
  const [row] = await database.db.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.code, 'MAIN'))
  if (!row) throw new Error('Expected default MAIN warehouse')
  return row.id
}

async function seedLot(
  variantId: string,
  options: { quantity?: number; expiryDate?: string; receivedAt?: Date; quarantined?: boolean; lotCode?: string } = {},
) {
  const suffix = crypto.randomUUID()
  const quarantined = options.quarantined ?? false
  return createService().receiveLot({
    warehouseId: await mainWarehouseId(),
    variantId,
    lotCode: options.lotCode ?? `RESERVE-${suffix.slice(0, 8)}`,
    quantity: options.quantity ?? 8,
    expiryDate: options.expiryDate ?? futureDate(30),
    ...(options.receivedAt ? { receivedAt: options.receivedAt } : {}),
    ...(quarantined ? { quarantined: true, quarantineReason: 'reservation test fixture' } : {}),
  }, { actor, idempotencyKey: `receive-${suffix}` })
}

function futureDate(days: number) {
  const date = new Date(`${bangkokDate(new Date())}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function expiredDate() {
  return futureDate(-1)
}

function command(idempotencyKey: string): CommandContext {
  return { actor, idempotencyKey }
}

describe('inventory reservations', () => {
  it('allocates FIFO across eligible lots and skips quarantined or short-shelf-life lots', async () => {
    const [variantId] = await seedVariants(1, 3)
    const tooShort = await seedLot(variantId, {
      quantity: 8,
      expiryDate: futureDate(2),
      receivedAt: new Date(Date.now() - 3 * 86_400_000),
    })
    const quarantined = await seedLot(variantId, {
      quantity: 8,
      quarantined: true,
      receivedAt: new Date(Date.now() - 2 * 86_400_000),
    })
    const oldestEligible = await seedLot(variantId, {
      quantity: 2,
      receivedAt: new Date(Date.now() - 86_400_000),
    })
    const newestEligible = await seedLot(variantId, { quantity: 5 })

    const reservation = await createService().reserve({
      warehouseId: await mainWarehouseId(),
      lines: [{ variantId, quantity: 4 }],
    }, command('reserve-fifo'))

    expect(reservation.status).toBe('active')
    expect(Date.parse(reservation.expiresAt) - Date.parse(reservation.createdAt)).toBe(15 * 60 * 1000)
    expect(reservation.allocations).toEqual([
      { variantId, lotId: oldestEligible.id, quantity: 2 },
      { variantId, lotId: newestEligible.id, quantity: 2 },
    ])
    expect((await createService().getLot(tooShort.id)).reservedQuantity).toBe(0)
    expect((await createService().getLot(quarantined.id)).reservedQuantity).toBe(0)
  })

  it('leaves every line unheld when a multi-variant request is duplicate or short', async () => {
    const [firstVariant, secondVariant] = await seedVariants(2)
    const firstLot = await seedLot(firstVariant, { quantity: 3 })
    const warehouseId = await mainWarehouseId()

    await expect(createService().reserve({ warehouseId, lines: [
      { variantId: firstVariant, quantity: 1 },
      { variantId: firstVariant, quantity: 1 },
    ] }, command('reserve-duplicate-line'))).rejects.toThrow()

    await expect(createService().reserve({ warehouseId, lines: [
      { variantId: firstVariant, quantity: 2 },
      { variantId: secondVariant, quantity: 1 },
    ] }, command('reserve-shortage'))).rejects.toThrow()

    expect((await createService().getLot(firstLot.id)).reservedQuantity).toBe(0)
    expect(await database.db.select().from(inventoryReservation)).toHaveLength(0)
    expect(await database.db.select().from(inventoryReservationAllocation)).toHaveLength(0)
  })

  it('replays the same idempotency key and rejects a changed request', async () => {
    const [variantId] = await seedVariants(1)
    await seedLot(variantId, { quantity: 5 })
    const warehouseId = await mainWarehouseId()
    const input = { warehouseId, lines: [{ variantId, quantity: 2 }] }
    const first = await createService().reserve(input, command('reserve-retry'))
    const retry = await createService().reserve(input, command('reserve-retry'))

    expect(retry).toEqual(first)
    await expect(createService().reserve({ ...input, lines: [{ variantId, quantity: 3 }] }, command('reserve-retry')))
      .rejects.toThrow()
    expect(await database.db.select().from(inventoryReservation)).toHaveLength(1)
    expect((await createService().getLot((await database.db.select({ id: inventoryLot.id }).from(inventoryLot))[0]!.id)).reservedQuantity).toBe(2)
  })

  it('commits overdue hold expiry even when a new multi-line request is short', async () => {
    const [availableVariant, unavailableVariant] = await seedVariants(2)
    const lot = await seedLot(availableVariant, { quantity: 2 })
    const now = new Date()
    const oldReservationId = crypto.randomUUID()
    await database.db.insert(inventoryReservation).values({
      id: oldReservationId,
      warehouseId: await mainWarehouseId(),
      status: 'active',
      createdAt: new Date(now.getTime() - 30 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 15 * 60 * 1000),
      actorId,
    })
    await database.db.insert(inventoryReservationAllocation).values({
      id: crypto.randomUUID(),
      reservationId: oldReservationId,
      variantId: availableVariant,
      lotId: lot.id,
      quantity: 2,
    })
    await database.db.update(inventoryLot).set({ reservedQuantity: 2 }).where(eq(inventoryLot.id, lot.id))

    const warehouseId = await mainWarehouseId()
    const input = {
      warehouseId,
      lines: [
        { variantId: availableVariant, quantity: 2 },
        { variantId: unavailableVariant, quantity: 1 },
      ],
    }
    await expect(createService().reserve(input, command('reserve-after-expiry-shortage'))).rejects.toThrow()
    await expect(createService().reserve(input, command('reserve-after-expiry-shortage'))).rejects.toThrow()

    const [expiredReservation] = await database.db.select().from(inventoryReservation)
      .where(eq(inventoryReservation.id, oldReservationId))
    const [operation] = await database.db.select().from(inventoryOperation)
      .where(eq(inventoryOperation.idempotencyKey, 'reserve-after-expiry-shortage'))
    expect(expiredReservation?.status).toBe('expired')
    expect(operation?.httpStatus).toBe(409)
    expect((await createService().getLot(lot.id)).reservedQuantity).toBe(0)
  })

  it('commits overdue hold expiry before returning a multi-line catalog conflict', async () => {
    const [availableVariant, draftVariant] = await seedVariants(2)
    const lot = await seedLot(availableVariant, { quantity: 2 })
    const [draftIdentity] = await database.db.select({ productId: productVariant.productId })
      .from(productVariant).where(eq(productVariant.id, draftVariant))
    if (!draftIdentity) throw new Error('Expected draft variant fixture')
    await database.db.update(product).set({ status: 'draft' }).where(eq(product.id, draftIdentity.productId))

    const now = new Date()
    const oldReservationId = crypto.randomUUID()
    await database.db.insert(inventoryReservation).values({
      id: oldReservationId,
      warehouseId: await mainWarehouseId(),
      status: 'active',
      createdAt: new Date(now.getTime() - 30 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 15 * 60 * 1000),
      actorId,
    })
    await database.db.insert(inventoryReservationAllocation).values({
      id: crypto.randomUUID(),
      reservationId: oldReservationId,
      variantId: availableVariant,
      lotId: lot.id,
      quantity: 2,
    })
    await database.db.update(inventoryLot).set({ reservedQuantity: 2 }).where(eq(inventoryLot.id, lot.id))

    const input = {
      warehouseId: await mainWarehouseId(),
      lines: [
        { variantId: availableVariant, quantity: 2 },
        { variantId: draftVariant, quantity: 1 },
      ],
    }
    await expect(createService().reserve(input, command('reserve-after-expiry-catalog-conflict')))
      .rejects.toMatchObject({ code: 'PRODUCT_STATE_CONFLICT' })

    const [expiredReservation] = await database.db.select().from(inventoryReservation)
      .where(eq(inventoryReservation.id, oldReservationId))
    const [expirationAudit] = await database.db.select().from(auditLog)
      .where(eq(auditLog.targetId, oldReservationId))
    const [operation] = await database.db.select().from(inventoryOperation)
      .where(eq(inventoryOperation.idempotencyKey, 'reserve-after-expiry-catalog-conflict'))
    expect(expiredReservation?.status).toBe('expired')
    expect((await createService().getLot(lot.id)).reservedQuantity).toBe(0)
    expect(expirationAudit?.action).toBe('inventory.reservation-expired')
    expect(operation?.httpStatus).toBe(409)
    expect(operation?.resultPayload).toMatchObject({ body: { code: 'PRODUCT_STATE_CONFLICT' } })
  })

  it('cancels a whole multi-lot, multi-variant reservation when any lot is quarantined', async () => {
    const [firstVariant, secondVariant] = await seedVariants(2)
    const olderLot = await seedLot(firstVariant, { quantity: 2, receivedAt: new Date(Date.now() - 86_400_000) })
    const quarantinedLot = await seedLot(firstVariant, { quantity: 2 })
    const otherVariantLot = await seedLot(secondVariant, { quantity: 2 })
    const warehouseId = await mainWarehouseId()
    const input = {
      warehouseId,
      lines: [{ variantId: firstVariant, quantity: 3 }, { variantId: secondVariant, quantity: 1 }],
    }
    const reservation = await createService().reserve(input, command('reserve-to-quarantine'))

    const quarantined = await createService().quarantineLot(quarantinedLot.id, 'inspection hold', {
      actor, idempotencyKey: 'quarantine-reserved-lot',
    })
    const [storedReservation] = await database.db.select().from(inventoryReservation)
      .where(eq(inventoryReservation.id, reservation.id))

    expect(quarantined.quarantinedAt).not.toBeNull()
    expect(storedReservation?.status).toBe('cancelled')
    expect((await createService().getLot(olderLot.id)).reservedQuantity).toBe(0)
    expect((await createService().getLot(otherVariantLot.id)).reservedQuantity).toBe(0)
    expect((await createService().getLot(quarantinedLot.id)).reservedQuantity).toBe(0)
  })

  it('releases quarantine only for a lot that remains within its expiry date', async () => {
    const [variantId] = await seedVariants(1)
    const safeLot = await seedLot(variantId, { quarantined: true })
    const expiredLot = await seedLot(variantId, { quarantined: true, expiryDate: expiredDate() })

    const released = await createService().releaseQuarantine(safeLot.id, {
      actor, idempotencyKey: 'release-safe-quarantine',
    })
    await expect(createService().releaseQuarantine(expiredLot.id, {
      actor, idempotencyKey: 'release-expired-quarantine',
    })).rejects.toThrow()

    expect(released.quarantinedAt).toBeNull()
    expect((await createService().getLot(expiredLot.id)).quarantinedAt).not.toBeNull()
  })

  it('rejects write-off and count changes that would remove held units', async () => {
    const [variantId] = await seedVariants(1)
    const lot = await seedLot(variantId, { quantity: 5 })
    const warehouseId = await mainWarehouseId()
    const input = { warehouseId, lines: [{ variantId, quantity: 3 }] }
    await createService().reserve(input, command('reserve-for-adjustments'))

    await expect(createService().adjustCount(lot.id, { countedQuantity: 2, reason: 'cycle_count' }, {
      actor, idempotencyKey: 'count-below-reserved',
    })).rejects.toThrow()
    await expect(createService().writeOff(lot.id, { quantity: 3, reason: 'damaged' }, {
      actor, idempotencyKey: 'writeoff-beyond-available',
    })).rejects.toThrow()

    expect(await createService().getLot(lot.id)).toMatchObject({ onHandQuantity: 5, reservedQuantity: 3 })
    expect(await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, lot.id))).toHaveLength(1)
  })

  it('serializes concurrent requests for overlapping variants without overselling or deadlocking', async () => {
    const variantIds = await seedVariants(2)
    const lots = await Promise.all(variantIds.map((variantId) => seedLot(variantId, { quantity: 1 })))
    const warehouseId = await mainWarehouseId()
    const firstInput = { warehouseId, lines: variantIds.map((variantId) => ({ variantId, quantity: 1 })) }
    const secondInput = { warehouseId, lines: [...firstInput.lines].reverse() }
    const attempt = (input: ReserveInput, key: string) => createService().reserve(input, command(key))
    const outcomes = await Promise.race([
      Promise.allSettled([attempt(firstInput, 'reserve-race-a'), attempt(secondInput, 'reserve-race-b')]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('reservation race timed out')), 10_000)),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    for (const lot of lots) expect((await createService().getLot(lot.id)).reservedQuantity).toBe(1)
    expect(await database.db.select().from(inventoryReservation)).toHaveLength(1)
  })
})
