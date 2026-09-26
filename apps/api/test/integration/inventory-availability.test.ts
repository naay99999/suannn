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
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { bangkokDate } from '../../src/modules/inventory/policy'
import { InventoryReservationRepository } from '../../src/modules/inventory/reservation-repository'
import { InventoryService } from '../../src/modules/inventory/service'
import { InventoryStockRepository } from '../../src/modules/inventory/stock-repository'
import { ProductRepository } from '../../src/modules/products/repository'
import { ProductService } from '../../src/modules/products/service'
import type { ProductActor } from '../../src/modules/products/types'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const actorId = 'inventory-availability-staff'
const actor: ProductActor = {
  userId: actorId,
  auditContext: { requestId: 'inventory-availability-test', ipAddress: '127.0.0.1', userAgent: 'test' },
}
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values({
    id: actorId,
    name: 'Inventory Availability Staff',
    email: 'inventory-availability-staff@example.test',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    accountType: 'staff',
    role: 'admin',
  })
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

function createInventoryService() {
  const readRepository = new InventoryReadRepository(database.db)
  return new InventoryService(
    new InventoryStockRepository(database.db),
    readRepository,
    new InventoryReservationRepository(database.db),
  )
}

function createProductService(
  availability: Pick<InventoryReadRepository, 'getSellableVariantIds'> = new InventoryReadRepository(database.db),
) {
  const audit = new AuditService(new AuditRepository(database.db))
  return new ProductService(new ProductRepository(database.db, audit, availability))
}

async function seedCatalog(options: { salesEnabled?: boolean } = {}) {
  const suffix = crypto.randomUUID()
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId,
    slug: `availability-${suffix}`,
    name: 'Availability product',
    category: 'fresh',
    status: 'published',
  })
  await database.db.insert(productVariant).values({
    id: variantId,
    productId,
    sku: `AVAILABILITY-${suffix}`,
    name: 'Availability unit',
    unit: 'unit',
    priceSatang: 100,
    salesEnabled: options.salesEnabled ?? true,
  })
  return { productId, variantId, slug: `availability-${suffix}` }
}

async function mainWarehouseId() {
  const [row] = await database.db.select({ id: warehouse.id }).from(warehouse)
    .where(eq(warehouse.code, 'MAIN'))
  if (!row) throw new Error('Expected default MAIN warehouse')
  return row.id
}

async function seedLot(variantId: string, options: {
  quantity?: number
  expiryDate?: string
  quarantined?: boolean
} = {}) {
  const quarantined = options.quarantined ?? false
  const [lot] = await database.db.insert(inventoryLot).values({
    warehouseId: await mainWarehouseId(),
    variantId,
    lotCode: `AVAIL-${crypto.randomUUID().slice(0, 8)}`,
    expiryDate: options.expiryDate ?? futureDate(30),
    quarantinedAt: quarantined ? new Date() : null,
    quarantineReason: quarantined ? 'availability test fixture' : null,
    onHandQuantity: options.quantity ?? 1,
  }).returning({ id: inventoryLot.id })
  if (!lot) throw new Error('Expected inserted inventory lot')
  return lot.id
}

function futureDate(days: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find(({ type: partType }) => partType === type)?.value
  const today = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`)
  today.setUTCDate(today.getUTCDate() + days)
  return today.toISOString().slice(0, 10)
}

function dateAfterBangkokDays(now: Date, days: number) {
  const date = new Date(`${bangkokDate(now)}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function setSystemTime(time: Date) {
  const SystemDate = globalThis.Date
  class FixedDate extends SystemDate {
    constructor(value?: string | number | Date) {
      if (value === undefined) super(time.getTime())
      else if (value instanceof SystemDate) super(value.getTime())
      else super(value)
    }

    static now() {
      return time.getTime()
    }
  }
  globalThis.Date = FixedDate as DateConstructor
  return () => { globalThis.Date = SystemDate }
}

describe('storefront inventory availability', () => {
  it('reports empty stock and manually disabled sales as unavailable', async () => {
    const empty = await seedCatalog()
    const disabled = await seedCatalog({ salesEnabled: false })
    await seedLot(disabled.variantId, { quantity: 1 })
    const service = createProductService()

    const emptyDetail = await service.getStoreBySlug(empty.slug)
    const disabledDetail = await service.getStoreBySlug(disabled.slug)
    const page = await service.listStore({ limit: 10 })

    expect(emptyDetail.variants[0]?.canPurchase).toBe(false)
    expect(emptyDetail.canPurchase).toBe(false)
    expect(disabledDetail.variants[0]?.canPurchase).toBe(false)
    expect(disabledDetail.canPurchase).toBe(false)
    expect(page.items.find(({ id }) => id === empty.productId)?.canPurchase).toBe(false)
    expect(page.items.find(({ id }) => id === disabled.productId)?.canPurchase).toBe(false)
    expect(JSON.stringify({ emptyDetail, disabledDetail, page })).not.toMatch(/lotCode|lotId|warehouseId|onHandQuantity|reservedQuantity|sellableQuantity/)
  })

  it('reports one eligible unit as purchasable in detail and summary', async () => {
    const catalog = await seedCatalog()
    await seedLot(catalog.variantId, { quantity: 1 })
    const service = createProductService()

    const detail = await service.getStoreBySlug(catalog.slug)
    const summary = (await service.listStore({ limit: 10 })).items.find(({ id }) => id === catalog.productId)

    expect(detail.variants[0]?.canPurchase).toBe(true)
    expect(detail.canPurchase).toBe(true)
    expect(summary?.canPurchase).toBe(true)
    expect(JSON.stringify({ detail, summary })).not.toMatch(/lotCode|lotId|warehouseId|onHandQuantity|reservedQuantity|sellableQuantity/)
  })

  it('reports the last unit unavailable after it is reserved', async () => {
    const catalog = await seedCatalog()
    await seedLot(catalog.variantId, { quantity: 1 })
    const products = createProductService()
    expect((await products.getStoreBySlug(catalog.slug)).variants[0]?.canPurchase).toBe(true)

    await createInventoryService().reserve({
      warehouseId: await mainWarehouseId(),
      lines: [{ variantId: catalog.variantId, quantity: 1 }],
    }, {
      actor,
      idempotencyKey: 'availability-reserve-last-unit',
    })

    expect((await products.getStoreBySlug(catalog.slug)).variants[0]?.canPurchase).toBe(false)
    expect((await products.getStoreBySlug(catalog.slug)).canPurchase).toBe(false)
  })

  it('reports quarantined, expired, and short shelf-life lots as unavailable', async () => {
    const quarantined = await seedCatalog()
    const expired = await seedCatalog()
    const shortShelfLife = await seedCatalog()
    await seedLot(quarantined.variantId, { quarantined: true })
    await seedLot(expired.variantId, { expiryDate: futureDate(-1) })
    await seedLot(shortShelfLife.variantId, { expiryDate: futureDate(2) })
    const products = createProductService()

    expect((await products.getStoreBySlug(shortShelfLife.slug)).canPurchase).toBe(true)
    await database.db.update(productVariant).set({ minRemainingShelfLifeDays: 2 })
      .where(eq(productVariant.id, shortShelfLife.variantId))

    for (const catalog of [quarantined, expired, shortShelfLife]) {
      const detail = await products.getStoreBySlug(catalog.slug)
      expect(detail.variants[0]?.canPurchase).toBe(false)
      expect(detail.canPurchase).toBe(false)
    }
  })

  it('restores availability after overdue reservations are cleaned up', async () => {
    const catalog = await seedCatalog()
    const lotId = await seedLot(catalog.variantId, { quantity: 1 })
    const inventory = createInventoryService()
    const reservation = await inventory.reserve({
      warehouseId: await mainWarehouseId(),
      lines: [{ variantId: catalog.variantId, quantity: 1 }],
    }, {
      actor,
      idempotencyKey: 'availability-reserve-before-cleanup',
    })
    const service = createProductService()
    expect((await service.getStoreBySlug(catalog.slug)).canPurchase).toBe(false)

    const now = new Date()
    await database.db.update(inventoryReservation).set({
      createdAt: new Date(now.getTime() - 30 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 15 * 60 * 1000),
    }).where(eq(inventoryReservation.id, reservation.id))
    expect(await inventory.expireDueReservations(10)).toBe(1)

    expect((await service.getStoreBySlug(catalog.slug)).variants[0]?.canPurchase).toBe(true)
    expect((await service.getStoreBySlug(catalog.slug)).canPurchase).toBe(true)
    const [storedLot] = await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, lotId))
    expect(storedLot?.reservedQuantity).toBe(0)
  })

  it('uses PostgreSQL transaction time at the Bangkok expiry boundary', async () => {
    const catalog = await seedCatalog()
    const [{ now: rawDatabaseNow }] = await database.db.select({ now: sql<Date>`transaction_timestamp()` })
      .from(warehouse).limit(1)
    const databaseNow = rawDatabaseNow instanceof Date ? rawDatabaseNow : new Date(String(rawDatabaseNow))
    await seedLot(catalog.variantId, { expiryDate: dateAfterBangkokDays(databaseNow, 1) })
    const applicationClock = new Date(databaseNow.getTime() + 2 * 86_400_000)
    const restoreSystemTime = setSystemTime(applicationClock)

    try {
      const detail = await createProductService().getStoreBySlug(catalog.slug)
      expect(detail.variants[0]?.canPurchase).toBe(true)
    } finally {
      restoreSystemTime()
    }
  })

  it('passes one page of active variants to one batched availability read', async () => {
    const catalogs = await Promise.all([seedCatalog(), seedCatalog(), seedCatalog()])
    const calls: string[][] = []
    const availability = {
      getSellableVariantIds: async (variantIds: readonly string[]) => {
        calls.push([...variantIds])
        return new Set([catalogs[1]!.variantId])
      },
    }
    const page = await createProductService(availability).listStore({ limit: 10 })

    expect(calls).toHaveLength(1)
    expect(new Set(calls[0])).toEqual(new Set(catalogs.map(({ variantId }) => variantId)))
    expect(page.items.find(({ id }) => id === catalogs[0]!.productId)?.canPurchase).toBe(false)
    expect(page.items.find(({ id }) => id === catalogs[1]!.productId)?.canPurchase).toBe(true)
    expect(page.items.find(({ id }) => id === catalogs[2]!.productId)?.canPurchase).toBe(false)
  })
})
