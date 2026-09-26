import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  auditLog,
  inventoryLot,
  inventoryOperation,
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
import { AuditService } from '../../src/modules/audit/service'
import type { CommandContext, ReceiveLotInput } from '../../src/modules/inventory/types'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const actorId = 'inventory-adjustment-staff'
const actor: CommandContext['actor'] = {
  kind: 'staff',
  userId: actorId,
  auditContext: { requestId: 'inventory-adjustment-test', ipAddress: '127.0.0.1', userAgent: 'test' },
}
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

beforeEach(async () => {
  await database.db.delete(auditLog)
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
    email: 'inventory-adjustment-staff@example.test',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    accountType: 'staff',
    role: 'admin',
  })
})

afterAll(async () => {
  await database.db.delete(auditLog)
  await database.db.delete(stockMovement)
  await database.db.delete(inventoryLot)
  await database.db.delete(inventoryOperation)
  await database.db.delete(productVariant)
  await database.db.delete(product)
  await database.db.delete(user).where(eq(user.id, actorId))
  await unlockDatabase?.()
  await database.client.end()
})

function createService(audit?: AuditService) {
  return new InventoryService(
    new InventoryStockRepository(database.db, audit),
    new InventoryReadRepository(database.db),
    new InventoryReservationRepository(database.db),
  )
}

async function seedLot(expiryDate = futureDate()) {
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  const suffix = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId,
    slug: `inventory-adjustment-${suffix}`,
    name: 'Inventory adjustment test product',
    category: 'fresh',
    status: 'published',
  })
  await database.db.insert(productVariant).values({
    id: variantId,
    productId,
    sku: `INVENTORY-ADJUSTMENT-${suffix}`,
    name: 'Test unit',
    unit: 'unit',
    priceSatang: 100,
    salesEnabled: true,
  })
  const [warehouseRow] = await database.db.select({ id: warehouse.id })
    .from(warehouse).where(eq(warehouse.code, 'MAIN'))
  if (!warehouseRow) throw new Error('Expected default MAIN warehouse')

  const input: ReceiveLotInput = {
    warehouseId: warehouseRow.id,
    variantId,
    lotCode: `ADJUST-${suffix.slice(0, 8)}`,
    quantity: 8,
    expiryDate,
    ...(expiryDate <= bangkokDate(new Date())
      ? { quarantined: true, quarantineReason: 'adjustment test fixture' }
      : {}),
  }
  const lot = await createService().receiveLot(input, { actor, idempotencyKey: `receive-${suffix}` })
  return lot
}

function futureDate(days = 30) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function expiredDate() {
  const today = new Date(`${bangkokDate(new Date())}T00:00:00.000Z`)
  today.setUTCDate(today.getUTCDate() - 1)
  return today.toISOString().slice(0, 10)
}

describe('inventory adjustments', () => {
  it('writes off physical units and records a signed movement without auditing the note', async () => {
    const lot = await seedLot()

    const adjusted = await createService().writeOff(lot.id, {
      quantity: 3,
      reason: 'spoiled',
      note: 'damaged packaging',
    }, { actor, idempotencyKey: 'write-off-spoiled' })
    const movements = await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, lot.id))
    const events = await database.db.select().from(auditLog).where(eq(auditLog.targetId, lot.id))
    const adjustmentMovement = movements.filter(({ type }) => type === 'write_off')
    const adjustmentEvents = events.filter(({ action }) => action === 'inventory.written-off')

    expect(adjusted.onHandQuantity).toBe(5)
    expect(movements).toHaveLength(2)
    expect(adjustmentMovement).toHaveLength(1)
    expect(adjustmentMovement[0]).toMatchObject({ type: 'write_off', reasonCode: 'spoiled', quantityDelta: -3, balanceAfter: 5 })
    expect(adjustmentEvents).toHaveLength(1)
    expect(adjustmentEvents[0]?.metadata).not.toHaveProperty('note')
  })

  it('rejects the expired reason for a lot that is still valid', async () => {
    const lot = await seedLot()

    await expect(createService().writeOff(lot.id, {
      quantity: 1,
      reason: 'expired',
    }, { actor, idempotencyKey: 'write-off-not-expired' })).rejects.toThrow()

    expect((await createService().getLot(lot.id)).onHandQuantity).toBe(8)
    expect(await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, lot.id))).toHaveLength(1)
    expect(await database.db.select().from(inventoryOperation)).toHaveLength(1)
  })

  it('records a signed count adjustment delta', async () => {
    const lot = await seedLot()

    const adjusted = await createService().adjustCount(lot.id, {
      countedQuantity: 5,
      reason: 'cycle_count',
    }, { actor, idempotencyKey: 'count-adjust-down' })
    const movements = await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, lot.id))
    const adjustmentMovements = movements.filter(({ type }) => type === 'count_adjustment')

    expect(adjusted.onHandQuantity).toBe(5)
    expect(movements).toHaveLength(2)
    expect(adjustmentMovements).toHaveLength(1)
    expect(adjustmentMovements[0]).toMatchObject({ type: 'count_adjustment', reasonCode: 'cycle_count', quantityDelta: -3, balanceAfter: 5 })
  })

  it('allows a zero count delta without adding a physical movement', async () => {
    const lot = await seedLot()

    const adjusted = await createService().adjustCount(lot.id, {
      countedQuantity: 8,
      reason: 'cycle_count',
    }, { actor, idempotencyKey: 'count-adjust-zero' })

    expect(adjusted.onHandQuantity).toBe(8)
    expect(await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, lot.id))).toHaveLength(1)
    expect(await database.db.select().from(inventoryOperation)).toHaveLength(2)
    expect(await database.db.select().from(auditLog).where(eq(auditLog.targetId, lot.id))).toHaveLength(2)
  })

  it('rejects negative and over-limit physical counts', async () => {
    const lot = await seedLot()
    const context = (idempotencyKey: string) => ({ actor, idempotencyKey })

    await expect(createService().adjustCount(lot.id, {
      countedQuantity: -1,
      reason: 'cycle_count',
    }, context('count-adjust-negative'))).rejects.toThrow()
    await expect(createService().adjustCount(lot.id, {
      countedQuantity: 1_000_000_001,
      reason: 'cycle_count',
    }, context('count-adjust-too-large'))).rejects.toThrow()

    expect((await createService().getLot(lot.id)).onHandQuantity).toBe(8)
    expect(await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, lot.id))).toHaveLength(1)
  })

  it('requires a lot to be expired before an expired write-off', async () => {
    const lot = await seedLot(expiredDate())

    const adjusted = await createService().writeOff(lot.id, {
      quantity: 2,
      reason: 'expired',
    }, { actor, idempotencyKey: 'write-off-expired' })
    const movement = await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, lot.id))
    const writeOffMovements = movement.filter(({ type }) => type === 'write_off')

    expect(adjusted.onHandQuantity).toBe(6)
    expect(writeOffMovements).toHaveLength(1)
    expect(writeOffMovements[0]).toMatchObject({ type: 'write_off', reasonCode: 'expired', quantityDelta: -2, balanceAfter: 6 })
  })

  it('replays a repeated adjustment key without applying its movement twice', async () => {
    const lot = await seedLot()
    const input = { quantity: 2, reason: 'damaged' as const }
    const first = await createService().writeOff(lot.id, input, { actor, idempotencyKey: 'write-off-retry' })
    const retry = await createService().writeOff(lot.id, input, { actor, idempotencyKey: 'write-off-retry' })

    expect(retry).toEqual(first)
    expect(await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, lot.id))).toHaveLength(2)
    expect(await database.db.select().from(inventoryOperation)).toHaveLength(2)
  })

  it('rolls back the balance, movement, operation, and audit if audit recording fails', async () => {
    const lot = await seedLot()
    class FailingAuditService extends AuditService {
      override async record(..._args: Parameters<AuditService['record']>) {
        throw new Error('audit unavailable')
      }
    }

    const failingService = createService(new FailingAuditService({} as never))
    await expect(failingService.writeOff(lot.id, {
      quantity: 2,
      reason: 'spoiled',
    }, { actor, idempotencyKey: 'write-off-audit-fail' })).rejects.toThrow('audit unavailable')

    expect((await createService().getLot(lot.id)).onHandQuantity).toBe(8)
    expect(await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, lot.id))).toHaveLength(1)
    expect(await database.db.select().from(inventoryOperation)).toHaveLength(1)
    expect(await database.db.select().from(auditLog).where(eq(auditLog.targetId, lot.id))).toHaveLength(1)
  })
})
