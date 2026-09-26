import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import {
  auditLog,
  commerceOrder,
  commerceSettings,
  inventoryLot,
  inventoryOperation,
  orderEvent,
  orderItemAllocation,
  orderOperation,
  payment,
  product,
  productVariant,
  stockMovement,
  user,
  warehouse,
} from '../../src/database/schema'
import { CartRepository } from '../../src/modules/cart/repository'
import { CartService } from '../../src/modules/cart/service'
import type { CartPrincipal } from '../../src/modules/cart/types'
import { QuoteService } from '../../src/modules/checkout/quote'
import { CheckoutService } from '../../src/modules/checkout/service'
import { CommerceSettingsRepository } from '../../src/modules/commerce-settings/repository'
import { CommerceSettingsService } from '../../src/modules/commerce-settings/service'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { InventoryReservationRepository } from '../../src/modules/inventory/reservation-repository'
import { InventoryService } from '../../src/modules/inventory/service'
import { InventoryStockRepository } from '../../src/modules/inventory/stock-repository'
import type { CommandContext } from '../../src/modules/inventory/types'
import { OrderService } from '../../src/modules/orders/service'
import type { OrderPrincipal } from '../../src/modules/orders/types'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const commerceSecret = new Uint8Array(32).fill(29)
const customerId = 'order-lifecycle-customer'
const otherCustomerId = 'order-lifecycle-other-customer'
const staffId = 'order-lifecycle-staff'
const auditContext = { requestId: 'order-lifecycle-test', ipAddress: '127.0.0.1', userAgent: 'test' }
const staffActor = { kind: 'staff' as const, userId: staffId, auditContext }
const staffInventoryActor: CommandContext['actor'] = staffActor
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

beforeEach(async () => {
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values([
    { id: customerId, name: 'Lifecycle Customer', email: 'lifecycle-customer@example.test', emailVerified: true, createdAt: now, updatedAt: now, role: 'customer', accountType: 'customer' },
    { id: otherCustomerId, name: 'Other Customer', email: 'lifecycle-other@example.test', emailVerified: true, createdAt: now, updatedAt: now, role: 'customer', accountType: 'customer' },
    { id: staffId, name: 'Lifecycle Staff', email: 'lifecycle-staff@example.test', emailVerified: true, createdAt: now, updatedAt: now, role: 'admin', accountType: 'staff' },
  ])
  await database.db.update(commerceSettings).set({
    shippingFeeSatang: 725,
    checkoutEnabled: true,
    version: 2,
  }).where(eq(commerceSettings.id, 1))
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

function guestPrincipal(seed = crypto.randomUUID()): CartPrincipal {
  return { kind: 'guest', tokenHash: createHash('sha256').update(seed).digest('hex') }
}

function futureDate(days = 30) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function expiredDate() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function services() {
  const audit = new AuditService(new AuditRepository(database.db))
  const cart = new CartService(new CartRepository(database.db, new InventoryReadRepository(database.db)))
  const settings = new CommerceSettingsService(new CommerceSettingsRepository(database.db, audit))
  const quote = new QuoteService(cart, settings, commerceSecret)
  const checkout = new CheckoutService(database.db, commerceSecret)
  const inventory = new InventoryService(
    new InventoryStockRepository(database.db, audit),
    new InventoryReadRepository(database.db),
    new InventoryReservationRepository(database.db),
  )
  return { cart, quote, checkout, inventory, orders: new OrderService(database.db) }
}

async function seedVariant(quantity: number | number[] = 8) {
  const suffix = crypto.randomUUID()
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId,
    slug: `order-lifecycle-${suffix}`,
    name: 'Lifecycle Fruit Box',
    category: 'fresh',
    status: 'published',
  })
  await database.db.insert(productVariant).values({
    id: variantId,
    productId,
    sku: `ORDER-LIFECYCLE-${suffix}`,
    name: 'Small box',
    unit: 'box',
    priceSatang: 1200,
    salesEnabled: true,
  })
  const [mainWarehouse] = await database.db.select({ id: warehouse.id })
    .from(warehouse).where(eq(warehouse.code, 'MAIN'))
  if (!mainWarehouse) throw new Error('Expected MAIN warehouse')
  const quantities = Array.isArray(quantity) ? quantity : [quantity]
  const lotIds: string[] = []
  for (const [index, lotQuantity] of quantities.entries()) {
    const lotId = crypto.randomUUID()
    lotIds.push(lotId)
    await database.db.insert(inventoryLot).values({
      id: lotId,
      warehouseId: mainWarehouse.id,
      variantId,
      lotCode: `ORDER-LIFECYCLE-${suffix.slice(0, 8)}-${index}`,
      receivedAt: new Date(Date.now() - (quantities.length - index) * 86_400_000),
      expiryDate: futureDate(),
      onHandQuantity: lotQuantity,
    })
  }
  return { productId, variantId, lotId: lotIds[0]!, lotIds, initialQuantity: quantities.reduce((total, current) => total + current, 0) }
}

async function placeOrder(options: {
  principal?: CartPrincipal
  quantity?: number
  stock?: number | number[]
} = {}) {
  const principal = options.principal ?? { kind: 'customer' as const, userId: customerId }
  const seeded = await seedVariant(options.stock ?? 8)
  const { cart, quote, checkout, orders, inventory } = services()
  await cart.setItem(principal, seeded.variantId, options.quantity ?? 2)
  const quoteResult = await quote.create(principal, new Date())
  const result = await checkout.placeCod({
    quoteToken: quoteResult.quoteToken,
    paymentMethod: 'cod',
    contact: { email: 'buyer@example.test', phone: '081-234-5678' },
    address: {
      recipientName: 'Somchai Buyer',
      addressLine1: '12 Orchard Road',
      subdistrict: 'Talat Noi',
      district: 'Samphanthawong',
      province: 'Bangkok',
      postalCode: '10100',
    },
  }, principal, `lifecycle-checkout-${crypto.randomUUID()}`)
  const orderPrincipal: OrderPrincipal = principal.kind === 'customer'
    ? { kind: 'customer', userId: principal.userId }
    : { kind: 'guest', accessToken: result.guestAccessToken! }
  return { ...seeded, result, orderPrincipal, orders, inventory }
}

describe('COD order lifecycle', () => {
  it('cancels an owned customer order and restores the exact sold units once', async () => {
    const placed = await placeOrder()

    const cancelled = await placed.orders.cancel(placed.result.order.id, placed.orderPrincipal, 'cancel-customer-1')
    const replayed = await placed.orders.cancel(placed.result.order.id, placed.orderPrincipal, 'cancel-customer-1')
    await placed.orders.cancel(placed.result.order.id, placed.orderPrincipal, 'cancel-customer-retry-2')
    const lotRows = await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, placed.lotId))
    const movements = await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, placed.lotId))
    const allocations = await database.db.select().from(orderItemAllocation)
      .where(eq(orderItemAllocation.orderId, placed.result.order.id))
    const payments = await database.db.select().from(payment).where(eq(payment.orderId, placed.result.order.id))

    expect(cancelled.status).toBe('cancelled')
    expect(replayed.status).toBe('cancelled')
    expect(lotRows[0]).toMatchObject({ onHandQuantity: placed.initialQuantity, reversibleQuantity: 0 })
    expect(movements.filter(({ type }) => type === 'order_cancel_restore')).toHaveLength(1)
    expect(movements.find(({ type }) => type === 'order_cancel_restore')).toMatchObject({ quantityDelta: 2, balanceAfter: placed.initialQuantity })
    expect(allocations.map(({ restorationStatus }) => restorationStatus)).toEqual(['restored'])
    expect(payments[0]?.status).toBe('void')
  })

  it('allows the guest access token and staff identity to cancel an order before shipment', async () => {
    const guestOrder = await placeOrder({ principal: guestPrincipal() })
    const guestCancelled = await guestOrder.orders.cancel(guestOrder.result.order.id, guestOrder.orderPrincipal, 'cancel-guest-1')

    const staffOrder = await placeOrder()
    const staffCancelled = await staffOrder.orders.cancel(staffOrder.result.order.id, staffActor, 'cancel-staff-1')

    expect(guestCancelled.status).toBe('cancelled')
    expect(staffCancelled.status).toBe('cancelled')
  })

  it('denies another customer and an invalid guest token at the service boundary', async () => {
    const placed = await placeOrder()
    const stranger = { kind: 'customer', userId: otherCustomerId } as const

    await expect(placed.orders.getForPrincipal(placed.result.order.id, stranger)).rejects.toMatchObject({ code: 'ORDER_ACCESS_DENIED' })
    await expect(placed.orders.cancel(placed.result.order.id, stranger, 'cancel-stranger-1')).rejects.toMatchObject({ code: 'ORDER_ACCESS_DENIED' })

    const guestOrder = await placeOrder({ principal: guestPrincipal() })
    await expect(guestOrder.orders.getForPrincipal(guestOrder.result.order.id, { kind: 'guest', accessToken: 'invalid' }))
      .rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })
  })

  it('rechecks guest access before replaying a command after the terminal access window expires', async () => {
    const placed = await placeOrder({ principal: guestPrincipal() })
    const orderId = placed.result.order.id
    const key = 'cancel-guest-expiry-replay-1'
    await placed.orders.cancel(orderId, placed.orderPrincipal, key)
    await database.db.update(commerceOrder).set({
      terminalAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    }).where(eq(commerceOrder.id, orderId))

    await expect(placed.orders.cancel(orderId, placed.orderPrincipal, key))
      .rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })
  })

  it('restores expired and quarantined lots without making them sellable', async () => {
    const expiredPlaced = await placeOrder()
    await database.db.update(inventoryLot).set({
      expiryDate: expiredDate(),
    }).where(eq(inventoryLot.id, expiredPlaced.lotId))
    await expiredPlaced.orders.cancel(expiredPlaced.result.order.id, expiredPlaced.orderPrincipal, 'cancel-expired-lot-1')
    const expiredLot = (await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, expiredPlaced.lotId)))[0]

    const quarantinedPlaced = await placeOrder()
    await database.db.update(inventoryLot).set({
      quarantinedAt: new Date(),
      quarantineReason: 'quarantined before cancellation',
    }).where(eq(inventoryLot.id, quarantinedPlaced.lotId))
    await quarantinedPlaced.orders.cancel(quarantinedPlaced.result.order.id, quarantinedPlaced.orderPrincipal, 'cancel-quarantined-lot-1')
    const quarantinedLot = (await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, quarantinedPlaced.lotId)))[0]

    expect(expiredLot).toMatchObject({ onHandQuantity: expiredPlaced.initialQuantity, reversibleQuantity: 0, expiryDate: expiredDate(), quarantinedAt: null })
    expect(await expiredPlaced.inventory.getLot(expiredPlaced.lotId)).toMatchObject({ sellableQuantity: 0 })
    expect(quarantinedLot).toMatchObject({ onHandQuantity: quarantinedPlaced.initialQuantity, reversibleQuantity: 0, quarantineReason: 'quarantined before cancellation' })
    expect(await quarantinedPlaced.inventory.getLot(quarantinedPlaced.lotId)).toMatchObject({ sellableQuantity: 0 })
  })

  it('restores each original FIFO lot allocation with one movement per lot', async () => {
    const placed = await placeOrder({ stock: [1, 3], quantity: 2 })

    await placed.orders.cancel(placed.result.order.id, placed.orderPrincipal, 'cancel-multi-lot-1')
    const lots = await database.db.select().from(inventoryLot).where(eq(inventoryLot.variantId, placed.variantId))
      .orderBy(asc(inventoryLot.receivedAt), asc(inventoryLot.id))
    const movements = await database.db.select().from(stockMovement)
      .then((rows) => rows.filter(({ type }) => type === 'order_cancel_restore'))

    expect(lots.map(({ id, onHandQuantity, reversibleQuantity }) => ({ id, onHandQuantity, reversibleQuantity })))
      .toEqual(placed.lotIds.map((id, index) => ({ id, onHandQuantity: [1, 3][index]!, reversibleQuantity: 0 })))
    expect(movements.map(({ lotId, quantityDelta }) => ({ lotId, quantityDelta })).sort((left, right) => left.lotId.localeCompare(right.lotId)))
      .toEqual([{ lotId: placed.lotIds[0]!, quantityDelta: 1 }, { lotId: placed.lotIds[1]!, quantityDelta: 1 }]
        .sort((left, right) => left.lotId.localeCompare(right.lotId)))
  })

  it('rolls back restoration, payment, operation, event, and order when cancellation audit fails', async () => {
    const placed = await placeOrder()
    await database.db.execute(sql.raw(`
      create function reject_order_cancel_audit() returns trigger language plpgsql as $$
      begin
        if new.action = 'order.cancelled' then raise exception 'simulated cancellation audit failure'; end if;
        return new;
      end;
      $$
    `))
    await database.db.execute(sql.raw(`
      create trigger reject_order_cancel_audit before insert on audit_log
      for each row execute function reject_order_cancel_audit()
    `))

    try {
      await expect(placed.orders.cancel(placed.result.order.id, placed.orderPrincipal, 'cancel-audit-failure-1'))
        .rejects.toThrow()
      const order = (await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, placed.result.order.id)))[0]
      const lot = (await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, placed.lotId)))[0]
      const savedPayment = (await database.db.select().from(payment).where(eq(payment.orderId, placed.result.order.id)))[0]
      const orderEvents = await database.db.select().from(orderEvent).where(eq(orderEvent.orderId, placed.result.order.id))
      const operations = await database.db.select().from(orderOperation).where(eq(orderOperation.orderId, placed.result.order.id))
      const inventoryOperations = await database.db.select().from(inventoryOperation)
        .where(eq(inventoryOperation.scope, 'orders.cancel.restore'))
      const movements = await database.db.select().from(stockMovement).where(eq(stockMovement.lotId, placed.lotId))

      expect(order?.status).toBe('placed')
      expect(lot).toMatchObject({ onHandQuantity: placed.initialQuantity - 2, reversibleQuantity: 2 })
      expect(savedPayment?.status).toBe('awaiting_collection')
      expect(orderEvents.filter(({ eventType }) => eventType === 'order.cancelled')).toHaveLength(0)
      expect(operations.filter(({ command }) => command === 'cancel')).toHaveLength(0)
      expect(inventoryOperations).toHaveLength(0)
      expect(movements.filter(({ type }) => type === 'order_cancel_restore')).toHaveLength(0)
    } finally {
      await database.db.execute(sql.raw('drop trigger if exists reject_order_cancel_audit on audit_log'))
      await database.db.execute(sql.raw('drop function if exists reject_order_cancel_audit()'))
    }
  })

  it('advances only adjacent fulfillment states and releases reversible capacity at shipment', async () => {
    const placed = await placeOrder()
    const orderId = placed.result.order.id

    await expect(placed.orders.advanceFulfillment(orderId, 'packed', staffActor, 'skip-processing-1'))
      .rejects.toMatchObject({ code: 'INVALID_ORDER_TRANSITION' })
    await placed.orders.advanceFulfillment(orderId, 'processing', staffActor, 'fulfill-processing-1')
    await placed.orders.advanceFulfillment(orderId, 'packed', staffActor, 'fulfill-packed-1')
    const shipped = await placed.orders.advanceFulfillment(orderId, 'shipped', staffActor, 'fulfill-shipped-1')
    const delivered = await placed.orders.advanceFulfillment(orderId, 'delivered', staffActor, 'fulfill-delivered-1')
    const lot = (await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, placed.lotId)))[0]
    const allocations = await database.db.select().from(orderItemAllocation).where(eq(orderItemAllocation.orderId, orderId))

    expect(shipped.status).toBe('shipped')
    expect(delivered.status).toBe('delivered')
    expect(lot).toMatchObject({ onHandQuantity: placed.initialQuantity - 2, reversibleQuantity: 0 })
    expect(allocations.map(({ restorationStatus }) => restorationStatus)).toEqual(['released'])
    await expect(placed.orders.cancel(orderId, placed.orderPrincipal, 'cancel-after-shipment-1'))
      .rejects.toMatchObject({ code: 'INVALID_ORDER_TRANSITION' })
  })

  it('makes cancellation and shipment mutually exclusive under concurrent requests', async () => {
    const placed = await placeOrder()
    const orderId = placed.result.order.id
    await placed.orders.advanceFulfillment(orderId, 'processing', staffActor, 'race-processing-1')
    await placed.orders.advanceFulfillment(orderId, 'packed', staffActor, 'race-packed-1')

    const outcomes = await Promise.allSettled([
      placed.orders.cancel(orderId, placed.orderPrincipal, 'race-cancel-1'),
      placed.orders.advanceFulfillment(orderId, 'shipped', staffActor, 'race-shipped-1'),
    ])
    const order = (await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, orderId)))[0]
    const lot = (await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, placed.lotId)))[0]
    const restores = await database.db.select().from(stockMovement)
      .where(eq(stockMovement.lotId, placed.lotId)).then((rows) => rows.filter(({ type }) => type === 'order_cancel_restore'))

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(order?.status).toMatch(/^(cancelled|shipped)$/)
    if (order?.status === 'cancelled') {
      expect(lot).toMatchObject({ onHandQuantity: placed.initialQuantity, reversibleQuantity: 0 })
      expect(restores).toHaveLength(1)
    } else {
      expect(lot).toMatchObject({ onHandQuantity: placed.initialQuantity - 2, reversibleQuantity: 0 })
      expect(restores).toHaveLength(0)
    }
  })

  it('collects the exact COD amount once and rejects a mismatched amount', async () => {
    const placed = await placeOrder()
    const staffOrder = await placed.orders.collectCod(placed.result.order.id, placed.result.order.totalSatang, staffActor, 'collect-cod-1')
    const replayed = await placed.orders.collectCod(placed.result.order.id, placed.result.order.totalSatang, staffActor, 'collect-cod-1')
    await placed.orders.collectCod(placed.result.order.id, placed.result.order.totalSatang, staffActor, 'collect-cod-repeat-2')
    const events = await database.db.select().from(orderEvent).where(eq(orderEvent.orderId, placed.result.order.id))
    const audits = await database.db.select().from(auditLog).where(eq(auditLog.targetId, placed.result.order.id))
    const operations = await database.db.select().from(orderOperation).where(eq(orderOperation.orderId, placed.result.order.id))

    expect(staffOrder.payment.status).toBe('collected')
    expect(replayed.payment.status).toBe('collected')
    expect(events.filter(({ eventType }) => eventType === 'payment.cod-collected')).toHaveLength(1)
    expect(audits.filter(({ action }) => action === 'order.cod-collected')).toHaveLength(1)
    expect(operations.filter(({ command }) => command === 'collect-cod')).toHaveLength(2)
    await expect(placed.orders.collectCod(placed.result.order.id, placed.result.order.totalSatang - 1, staffActor, 'collect-cod-wrong-1'))
      .rejects.toMatchObject({ code: 'COD_AMOUNT_MISMATCH' })
  })

  it('preserves a collected COD payment when an order is cancelled before shipment', async () => {
    const placed = await placeOrder()
    await placed.orders.collectCod(placed.result.order.id, placed.result.order.totalSatang, staffActor, 'collect-before-cancel-1')

    const cancelled = await placed.orders.cancel(placed.result.order.id, placed.orderPrincipal, 'cancel-after-collect-1')
    const savedPayment = (await database.db.select().from(payment).where(eq(payment.orderId, placed.result.order.id)))[0]

    expect(cancelled.status).toBe('cancelled')
    expect(savedPayment?.status).toBe('collected')
  })

  it('returns owner-filtered customer pages and a deterministic staff page', async () => {
    const first = await placeOrder()
    const second = await placeOrder()
    await placeOrder({ principal: guestPrincipal() })

    const firstPage = await first.orders.listCustomer(customerId, undefined, 1)
    const secondPage = await first.orders.listCustomer(customerId, firstPage.nextCursor ?? undefined, 1)
    const staffPage = await first.orders.listStaff(staffActor, undefined, 10)
    const staffDetail = await first.orders.getForPrincipal(second.result.order.id, staffActor)

    expect(() => first.orders.listStaff({ kind: 'staff', userId: '' }, undefined, 10)).toThrow()

    expect(firstPage.items).toHaveLength(1)
    expect(secondPage.items).toHaveLength(1)
    expect(new Set([...firstPage.items, ...secondPage.items].map(({ customerId: owner }) => owner)))
      .toEqual(new Set([customerId]))
    expect(firstPage.nextCursor).not.toBeNull()
    expect(secondPage.nextCursor).toBeNull()
    expect(staffPage.items).toHaveLength(3)
    expect(staffDetail.id).toBe(second.result.order.id)
  })

  it('keeps count adjustment within reversible capacity while cancellation races the count', async () => {
    const placed = await placeOrder({ stock: 8, quantity: 2 })

    await expect(placed.inventory.adjustCount(placed.lotId, { countedQuantity: 1_000_000_000, reason: 'cycle_count' }, {
      actor: staffInventoryActor,
      idempotencyKey: 'count-over-reversible-capacity',
    })).rejects.toMatchObject({ code: 'INVENTORY_STOCK_CONFLICT' })

    const outcomes = await Promise.allSettled([
      placed.orders.cancel(placed.result.order.id, placed.orderPrincipal, 'capacity-race-cancel-1'),
      placed.inventory.adjustCount(placed.lotId, { countedQuantity: 999_999_998, reason: 'cycle_count' }, {
        actor: staffInventoryActor,
        idempotencyKey: 'capacity-race-count-1',
      }),
    ])
    const lot = (await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, placed.lotId)))[0]

    expect(outcomes.every(({ status }) => status === 'fulfilled')).toBe(true)
    expect(lot!.onHandQuantity + lot!.reversibleQuantity).toBeLessThanOrEqual(1_000_000_000)
    expect(lot!.reversibleQuantity).toBe(0)
  })
})
