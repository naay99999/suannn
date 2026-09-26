import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { and, eq, sql } from 'drizzle-orm'
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
import { InventoryService } from '../../src/modules/inventory/service'
import { InventoryStockRepository } from '../../src/modules/inventory/stock-repository'
import type { CommandContext, ReceiveLotInput } from '../../src/modules/inventory/types'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const actorId = 'inventory-stock-staff'
const actor: CommandContext['actor'] = {
  userId: actorId,
  auditContext: { requestId: 'inventory-stock-test', ipAddress: '127.0.0.1', userAgent: 'test' },
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
    email: 'inventory-staff@example.test',
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

function createService() {
  return new InventoryService(
    new InventoryStockRepository(database.db),
    new InventoryReadRepository(database.db),
  )
}

async function seedVariant(status: 'draft' | 'published' = 'published') {
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  const suffix = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId,
    slug: `inventory-${suffix}`,
    name: 'Inventory test product',
    category: 'fresh',
    status,
  })
  await database.db.insert(productVariant).values({
    id: variantId,
    productId,
    sku: `INVENTORY-${suffix}`,
    name: 'Test unit',
    unit: 'unit',
    priceSatang: 100,
    salesEnabled: true,
  })
  return { productId, variantId }
}

async function mainWarehouseId() {
  const [row] = await database.db.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.code, 'MAIN'))
  if (!row) throw new Error('Expected default MAIN warehouse')
  return row.id
}

function futureDate(days = 30) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function receiptInput(variantId: string, lotCode: string, changes: Partial<ReceiveLotInput> = {}): ReceiveLotInput {
  return {
    warehouseId: '',
    variantId,
    lotCode,
    quantity: 4,
    expiryDate: futureDate(),
    receivedAt: new Date(Date.now() - 1_000).toISOString(),
    ...changes,
  }
}

async function receive(input: ReceiveLotInput, key: string = crypto.randomUUID()) {
  return createService().receiveLot(input, { actor, idempotencyKey: key })
}

describe('inventory receipt and read persistence', () => {
  it('receives one normalized lot and records one positive receipt movement', async () => {
    const { variantId } = await seedVariant()
    const input = receiptInput(variantId, ' lot-100 ')
    input.warehouseId = await mainWarehouseId()

    const lot = await receive(input, 'receipt-one')
    const lots = await database.db.select().from(inventoryLot).where(eq(inventoryLot.variantId, variantId))
    const movements = await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, lot.id))
    const events = await database.db.select().from(auditLog).where(eq(auditLog.targetId, lot.id))

    expect(lots).toHaveLength(1)
    expect(lot.lotCode).toBe('LOT-100')
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({ type: 'receipt', quantityDelta: 4, balanceAfter: 4 })
    expect(events).toHaveLength(1)
    expect(events[0]?.action).toBe('inventory.received')
  })

  it('reconciles physical stock summaries with the movement ledger', async () => {
    const { variantId } = await seedVariant()
    const input = receiptInput(variantId, 'RECONCILE')
    input.warehouseId = await mainWarehouseId()
    await receive(input, 'receipt-reconcile')

    const summary = await createService().getVariantSummary(variantId, input.warehouseId)
    const [ledger] = await database.db.select({ quantity: sql<number>`sum(${stockMovement.quantityDelta})` })
      .from(stockMovement)
      .innerJoin(inventoryLot, eq(inventoryLot.id, stockMovement.lotId))
      .where(and(eq(inventoryLot.variantId, variantId), eq(inventoryLot.warehouseId, input.warehouseId)))
    expect(summary.onHandQuantity).toBe(4)
    expect(summary.onHandQuantity).toBe(Number(ledger?.quantity))
  })

  it('paginates lots and movements without duplicate rows', async () => {
    const { variantId } = await seedVariant()
    const warehouseId = await mainWarehouseId()
    for (const [index, code] of ['PAGE-1', 'PAGE-2'].entries()) {
      await receive(receiptInput(variantId, code, {
        warehouseId,
        receivedAt: new Date(Date.now() - (index + 1) * 10_000).toISOString(),
      }), `receipt-page-${index}`)
    }

    const service = createService()
    const firstLots = await service.listLots({ variantId, warehouseId, limit: 1 })
    const secondLots = await service.listLots({
      variantId,
      warehouseId,
      limit: 1,
      cursor: firstLots.nextCursor ?? undefined,
    })
    const firstMovements = await service.listMovements({ variantId, warehouseId, limit: 1 })
    const secondMovements = await service.listMovements({
      variantId,
      warehouseId,
      limit: 1,
      cursor: firstMovements.nextCursor ?? undefined,
    })

    expect(firstLots.nextCursor).toBeString()
    expect(new Set([...firstLots.items, ...secondLots.items].map((lot) => lot.id)).size).toBe(2)
    expect(firstMovements.nextCursor).toBeString()
    expect(new Set([...firstMovements.items, ...secondMovements.items].map((movement) => movement.id)).size).toBe(2)
  })

  it('shows draft product stock to staff without marking it sellable', async () => {
    const { variantId } = await seedVariant('draft')
    const input = receiptInput(variantId, 'DRAFT-STOCK')
    input.warehouseId = await mainWarehouseId()
    await receive(input, 'receipt-draft')

    const service = createService()
    const summary = await service.getVariantSummary(variantId, input.warehouseId)
    const lot = await service.getLot((await service.listLots({ variantId, warehouseId: input.warehouseId })).items[0]!.id)
    expect(summary.onHandQuantity).toBe(4)
    expect(summary.sellableQuantity).toBe(0)
    expect(lot.onHandQuantity).toBe(4)
    expect(lot.sellableQuantity).toBe(0)
  })

  it('allows an expired receipt only when the lot starts in quarantine', async () => {
    const { variantId } = await seedVariant()
    const warehouseId = await mainWarehouseId()
    const expiredInput = receiptInput(variantId, 'EXPIRED', {
      warehouseId,
      expiryDate: bangkokDate(new Date()),
      quarantined: true,
      quarantineReason: 'inspection',
    })
    const lot = await receive(expiredInput, 'receipt-expired')
    expect(lot.quarantinedAt).not.toBeNull()
    expect(lot.sellableQuantity).toBe(0)

    await expect(receive({ ...expiredInput, lotCode: 'EXPIRED-OPEN', quarantined: false }, 'receipt-expired-open'))
      .rejects.toThrow('INVALID_RECEIPT')
  })

  it('rejects future received times and malformed lot codes', async () => {
    const { variantId } = await seedVariant()
    const warehouseId = await mainWarehouseId()
    await expect(receive(receiptInput(variantId, 'FUTURE', {
      warehouseId,
      receivedAt: new Date(Date.now() + 60_000).toISOString(),
    }), 'receipt-future')).rejects.toThrow('INVALID_RECEIPT')
    await expect(receive(receiptInput(variantId, 'bad lot code!', { warehouseId }), 'receipt-malformed'))
      .rejects.toThrow('INVALID_LOT_CODE')
  })

  it('conflicts on duplicate normalized lot codes', async () => {
    const { variantId } = await seedVariant()
    const warehouseId = await mainWarehouseId()
    await receive(receiptInput(variantId, ' lot-duplicate ', { warehouseId }), 'receipt-duplicate-one')
    await expect(receive(receiptInput(variantId, 'Lot-Duplicate', { warehouseId }), 'receipt-duplicate-two'))
      .rejects.toThrow('LOT_CODE_CONFLICT')
  })

  it('conflicts when an idempotency key is reused for a different request', async () => {
    const { variantId } = await seedVariant()
    const warehouseId = await mainWarehouseId()
    const input = receiptInput(variantId, 'HASHED-REQUEST', { warehouseId })
    await receive(input, 'receipt-key-reused')
    await expect(receive({ ...input, quantity: input.quantity + 1 }, 'receipt-key-reused'))
      .rejects.toThrow('INVENTORY_OPERATION_CONFLICT')
    expect(await database.db.select().from(inventoryLot)).toHaveLength(1)
    expect(await database.db.select().from(stockMovement)).toHaveLength(1)
  })

  it('replays concurrent same-key receipts with one lot and movement', async () => {
    const { variantId } = await seedVariant()
    const input = receiptInput(variantId, 'IDEMPOTENT')
    input.warehouseId = await mainWarehouseId()
    const [first, second] = await Promise.all([
      receive(input, 'receipt-same-key'),
      receive(input, 'receipt-same-key'),
    ])

    expect(first).toEqual(second)
    expect(await database.db.select().from(inventoryLot).where(eq(inventoryLot.variantId, variantId))).toHaveLength(1)
    expect(await database.db.select().from(stockMovement)).toHaveLength(1)
    expect(await database.db.select().from(inventoryOperation)).toHaveLength(1)
  })
})
