import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import {
  applicationSetting,
  auditLog,
  commerceOrder,
  commerceSettings,
  inventoryLot,
  inventoryOperation,
  inventoryReservation,
  orderOutbox,
  product,
  productVariant,
  stockMovement,
  user,
  warehouse,
} from '../../src/database/schema'
import { buildDemoFixtures } from '../../src/cli/demo/fixtures'
import { seedDemo } from '../../src/cli/demo/seed'
import { parseDemoSeedOptions } from '../../src/cli/seed-demo'
import { InventoryStockRepository } from '../../src/modules/inventory/stock-repository'
import type { CommandContext, ReceiveLotInput } from '../../src/modules/inventory/types'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const ownerId = 'demo-seed-owner'
const ownerEmail = 'demo-seed-owner@example.test'
const options = parseDemoSeedOptions([
  '--database-name', 'suannn_test',
  '--actor-email', ownerEmail,
  '--image-base-url', 'https://assets.example.test/suannn',
], 'test')
const now = new Date('2026-10-02T10:00:00.000Z')
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
  await database.db.delete(inventoryReservation)
  await database.db.delete(productVariant)
  await database.db.delete(product)
  await database.db.delete(user).where(eq(user.id, ownerId))
})

afterAll(async () => {
  await database.db.delete(auditLog)
  await database.db.delete(stockMovement)
  await database.db.delete(inventoryLot)
  await database.db.delete(inventoryOperation)
  await database.db.delete(inventoryReservation)
  await database.db.delete(productVariant)
  await database.db.delete(product)
  await database.db.delete(user).where(eq(user.id, ownerId))
  await unlockDatabase?.()
  await database.client.end()
})

async function createOwner() {
  const createdAt = new Date('2025-01-01T00:00:00.000Z')
  await database.db.insert(user).values({
    id: ownerId,
    name: 'Demo Seed Owner',
    email: ownerEmail,
    emailVerified: true,
    createdAt,
    updatedAt: createdAt,
    accountType: 'staff',
    role: 'owner',
    banned: false,
    staffActivatedAt: createdAt,
  })
}

async function mainWarehouseId() {
  const [row] = await database.db.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.code, 'MAIN'))
  if (!row) throw new Error('Expected migrated MAIN warehouse')
  return row.id
}

async function rowCounts() {
  const [products] = await database.db.select({ count: sql<number>`count(*)::int` }).from(product)
  const [variants] = await database.db.select({ count: sql<number>`count(*)::int` }).from(productVariant)
  const [lots] = await database.db.select({ count: sql<number>`count(*)::int` }).from(inventoryLot)
  const [operations] = await database.db.select({ count: sql<number>`count(*)::int` }).from(inventoryOperation)
  const [movements] = await database.db.select({ count: sql<number>`count(*)::int` }).from(stockMovement)
  const [audits] = await database.db.select({ count: sql<number>`count(*)::int` }).from(auditLog)
  return { products: products!.count, variants: variants!.count, lots: lots!.count,
    operations: operations!.count, movements: movements!.count, audits: audits!.count }
}

async function seedOptions() {
  return { ...options, databaseName: 'suannn_test', warehouseId: await mainWarehouseId() }
}

describe('catalog and stock demo seed', () => {
  it('creates the fixture atomically with linked ledger and audit rows and no external side effects', async () => {
    await createOwner()
    const beforeSettings = {
      application: await database.db.select().from(applicationSetting),
      commerce: await database.db.select().from(commerceSettings),
    }
    const result = await seedDemo(database.db, await seedOptions(), now)

    expect(result).toEqual({ status: 'created', products: 8, variants: 12, lots: 16, movements: 18 })
    expect(await rowCounts()).toEqual({ products: 8, variants: 12, lots: 16, operations: 18, movements: 18, audits: 48 })
    expect(await database.db.select().from(inventoryReservation)).toHaveLength(0)
    expect(await database.db.select().from(commerceOrder)).toHaveLength(0)
    expect(await database.db.select().from(orderOutbox)).toHaveLength(0)
    expect(await database.db.select().from(applicationSetting)).toEqual(beforeSettings.application)
    expect(await database.db.select().from(commerceSettings)).toEqual(beforeSettings.commerce)

    const fixtures = buildDemoFixtures({ now, warehouseId: await mainWarehouseId(), actorId: ownerId, imageBaseUrl: options.imageBaseUrl })
    const storedMovements = await database.db.select().from(stockMovement)
    const storedOperations = await database.db.select().from(inventoryOperation)
    const storedAudits = await database.db.select().from(auditLog)
    expect(storedMovements.map(({ id }) => id).sort()).toEqual(fixtures.manifest.movementIds.sort())
    expect(storedOperations.map(({ id }) => id).sort()).toEqual(fixtures.manifest.operationIds.sort())
    expect(storedAudits.map(({ id }) => id).sort()).toEqual(fixtures.manifest.auditIds.sort())
    expect(storedMovements.every(({ operationId, actorId }) =>
      fixtures.manifest.operationIds.includes(operationId) && actorId === ownerId)).toBe(true)
    expect(storedAudits.every(({ actorUserId }) => actorUserId === ownerId)).toBe(true)
  })

  it('replays an eligible seeded receipt through the stock command with runtime response and execution timestamps', async () => {
    await createOwner()
    const seedOpts = await seedOptions()
    await seedDemo(database.db, seedOpts, now)

    const fixtures = buildDemoFixtures({
      now,
      warehouseId: seedOpts.warehouseId,
      actorId: ownerId,
      imageBaseUrl: options.imageBaseUrl,
    })
    const seededLot = fixtures.lots[0]!
    const receiptMovement = fixtures.movements.find(({ lotId, type }) => lotId === seededLot.id && type === 'receipt')!
    const receiptOperation = fixtures.operations.find(({ scope, idempotencyKey }) =>
      scope === 'inventory.receive-lot' && idempotencyKey === 'demo-v1-receipt-01')!
    const lotId = seededLot.id!
    const operationId = receiptOperation.id!
    const receivedAt = seededLot.receivedAt!.toISOString()
    const receipt: ReceiveLotInput = {
      warehouseId: seededLot.warehouseId!,
      variantId: seededLot.variantId!,
      lotCode: seededLot.lotCode!,
      quantity: receiptMovement.quantityDelta!,
      expiryDate: seededLot.expiryDate!,
      receivedAt,
      quarantined: false,
    }
    const actor: CommandContext['actor'] = {
      kind: 'staff',
      userId: ownerId,
      auditContext: { requestId: 'demo-receipt-replay-test', ipAddress: '127.0.0.1', userAgent: 'test' },
    }
    const replayed = await new InventoryStockRepository(database.db).receiveLot(receipt, {
      actor,
      idempotencyKey: 'demo-v1-receipt-01',
    })
    const [operation] = await database.db.select().from(inventoryOperation).where(eq(inventoryOperation.id, operationId))
    const [movement] = await database.db.select().from(stockMovement).where(eq(stockMovement.operationId, operationId))
    const [audit] = await database.db.select().from(auditLog).where(eq(auditLog.targetId, lotId))

    expect(replayed).toEqual({
      id: lotId,
      warehouseId: seededLot.warehouseId,
      variantId: seededLot.variantId,
      lotCode: seededLot.lotCode,
      receivedAt,
      expiryDate: seededLot.expiryDate,
      quarantinedAt: null,
      quarantineReason: null,
      onHandQuantity: receiptMovement.quantityDelta,
      reservedQuantity: 0,
      sellableQuantity: 100,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    expect(operation?.createdAt).toEqual(now)
    expect(movement?.occurredAt).toEqual(now)
    expect(audit?.occurredAt).toEqual(now)
    expect(await rowCounts()).toMatchObject({ products: 8, variants: 12, lots: 16, operations: 18, movements: 18 })
  })

  it('returns already-seeded without overwriting edits or timestamps', async () => {
    await createOwner()
    const seedOpts = await seedOptions()
    await seedDemo(database.db, seedOpts, now)
    const fixtures = buildDemoFixtures({ now, warehouseId: seedOpts.warehouseId, actorId: ownerId, imageBaseUrl: options.imageBaseUrl })
    const editedAt = new Date('2026-10-03T02:03:04.000Z')
    await database.db.update(product).set({ name: 'แก้ไขโดยผู้ใช้', updatedAt: editedAt })
      .where(eq(product.id, fixtures.manifest.productIds[0]!))

    const result = await seedDemo(database.db, seedOpts, new Date('2026-10-10T12:00:00.000Z'))
    const [edited] = await database.db.select().from(product).where(eq(product.id, fixtures.manifest.productIds[0]!))

    expect(result.status).toBe('already-seeded')
    expect(edited?.name).toBe('แก้ไขโดยผู้ใช้')
    expect(edited?.updatedAt).toEqual(editedAt)
    expect(await rowCounts()).toMatchObject({ products: 8, variants: 12, lots: 16, operations: 18, movements: 18 })
  })

  it('rejects a partial fixture without repairing it', async () => {
    await createOwner()
    const seedOpts = await seedOptions()
    const fixture = buildDemoFixtures({ now, warehouseId: seedOpts.warehouseId, actorId: ownerId, imageBaseUrl: options.imageBaseUrl })
    await database.db.insert(product).values(fixture.products[0]!)

    await expect(seedDemo(database.db, seedOpts, now)).rejects.toThrow()
    expect(await rowCounts()).toMatchObject({ products: 1, variants: 0, lots: 0, operations: 0, movements: 0 })
  })

  it('rejects reserved slug, SKU, and lot-code collisions before fixture writes', async () => {
    for (const kind of ['slug', 'sku', 'lot'] as const) {
      await beforeEachCleanupForCollision()
      await createOwner()
      const warehouseId = await mainWarehouseId()
      const productId = 'f3000000-0000-4000-8000-000000000001'
      const variantId = 'f3000000-0000-4000-8000-000000000002'
      await database.db.insert(product).values({
        id: productId,
        slug: kind === 'slug' ? 'demo-v1-product-01' : 'demo-collision-product',
        name: 'Existing user product',
        category: 'fresh',
      })
      if (kind !== 'slug') {
        await database.db.insert(productVariant).values({
          id: variantId,
          productId,
          sku: kind === 'sku' ? 'DEMO-V1-01' : 'DEMO-COLLISION-SKU',
          name: 'Existing user variant',
          unit: 'แพ็ก',
          priceSatang: 1000,
        })
      }
      if (kind === 'lot') {
        await database.db.insert(inventoryLot).values({
          id: 'f3000000-0000-4000-8000-000000000003',
          warehouseId,
          variantId,
          lotCode: 'DEMO-V1-LOT-01',
          expiryDate: '2026-12-01',
        })
      }

      await expect(seedDemo(database.db, await seedOptions(), now)).rejects.toThrow()
      expect(await database.db.select().from(product)).toHaveLength(1)
      expect((await database.db.select().from(product))[0]?.id).toBe(productId)
    }
  })

  it('rejects a wrong database name and a missing or inactive owner', async () => {
    await createOwner()
    const seedOpts = await seedOptions()
    await expect(seedDemo(database.db, { ...seedOpts, databaseName: 'wrong_database' }, now)).rejects.toThrow()
    await expect(seedDemo(database.db, { ...seedOpts, actorEmail: 'missing@example.test' }, now)).rejects.toThrow()

    await database.db.update(user).set({ banned: true }).where(eq(user.id, ownerId))
    await expect(seedDemo(database.db, seedOpts, now)).rejects.toThrow()
  })

  it('rolls back all fixture tables when a movement insert fails', async () => {
    await createOwner()
    await database.client.unsafe(`
      create function task7_fail_demo_movement() returns trigger language plpgsql as $$
      begin raise exception 'INJECTED_SEED_FAILURE'; end;
      $$
    `)
    await database.client.unsafe(`
      create trigger task7_fail_demo_movement before insert on stock_movement
      for each row execute function task7_fail_demo_movement()
    `)

    try {
      await expect(seedDemo(database.db, await seedOptions(), now)).rejects.toThrow()
      expect(await rowCounts()).toEqual({ products: 0, variants: 0, lots: 0, operations: 0, movements: 0, audits: 0 })
    } finally {
      await database.client.unsafe('drop trigger if exists task7_fail_demo_movement on stock_movement')
      await database.client.unsafe('drop function if exists task7_fail_demo_movement()')
    }
  })

  it('serializes concurrent runs so exactly one creates the fixture', async () => {
    await createOwner()
    const seedOpts = await seedOptions()
    const results = await Promise.all([
      seedDemo(database.db, seedOpts, now),
      seedDemo(database.db, seedOpts, now),
    ])

    expect(results.map(({ status }) => status).sort()).toEqual(['already-seeded', 'created'])
    expect(await rowCounts()).toMatchObject({ products: 8, variants: 12, lots: 16, operations: 18, movements: 18 })
  })
})

async function beforeEachCleanupForCollision() {
  await database.db.delete(auditLog)
  await database.db.delete(stockMovement)
  await database.db.delete(inventoryLot)
  await database.db.delete(inventoryOperation)
  await database.db.delete(inventoryReservation)
  await database.db.delete(productVariant)
  await database.db.delete(product)
  await database.db.delete(user).where(eq(user.id, ownerId))
}
