import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  commerceOrder,
  commerceSettings,
  customerAddress,
  auditLog,
  inventoryLot,
  inventoryReservation,
  inventoryReservationAllocation,
  orderEvent,
  orderItem,
  orderItemAllocation,
  orderOperation,
  orderOutbox,
  payment,
  stripeCheckoutAttempt,
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
import { createPlaceOrderInTransaction, normalizeCheckoutInput } from '../../src/modules/checkout/placement'
import { StripePaymentRepository } from '../../src/modules/payments/stripe/repository'
import { CommerceSettingsRepository } from '../../src/modules/commerce-settings/repository'
import { CommerceSettingsService } from '../../src/modules/commerce-settings/service'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const commerceSecret = new Uint8Array(32).fill(19)
const actorId = 'checkout-test-owner'
let unlockDatabase: (() => Promise<void>) | undefined

const inlineAddress = {
  recipientName: '  Somchai Buyer  ',
  addressLine1: '  12 Orchard Road  ',
  addressLine2: '  Building A  ',
  subdistrict: '  Talat Noi  ',
  district: '  Samphanthawong  ',
  province: '  Bangkok  ',
  postalCode: '10100',
}

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

beforeEach(async () => {
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values({
    id: actorId,
    name: 'Checkout Test Customer',
    email: 'checkout-test@example.test',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    role: 'customer',
    accountType: 'customer',
  })
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

function createServices(now: () => Date = () => new Date()) {
  const audit = new AuditService(new AuditRepository(database.db))
  const settings = new CommerceSettingsService(new CommerceSettingsRepository(database.db, audit))
  const cartService = new CartService(new CartRepository(database.db, new InventoryReadRepository(database.db)))
  const quote = new QuoteService(cartService, settings, commerceSecret)
  const checkout = new CheckoutService(database.db, commerceSecret, now)
  return { cartService, quote, checkout }
}

function guestPrincipal(seed: string = crypto.randomUUID()): CartPrincipal {
  return { kind: 'guest', tokenHash: createHash('sha256').update(seed).digest('hex') }
}

async function createCustomer(id: string) {
  const now = new Date()
  await database.db.insert(user).values({
    id,
    name: 'Another Checkout Customer',
    email: `${id}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    role: 'customer',
    accountType: 'customer',
  })
  return { kind: 'customer', userId: id } as const
}

async function seedVariant(options: { priceSatang?: number; quantities?: number[]; quantity?: number } = {}) {
  const suffix = crypto.randomUUID()
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId,
    slug: `checkout-${suffix}`,
    name: 'Checkout Fruit Box',
    category: 'fresh',
    status: 'published',
  })
  await database.db.insert(productVariant).values({
    id: variantId,
    productId,
    sku: `CHECKOUT-${suffix}`,
    name: 'Small box',
    unit: 'box',
    priceSatang: options.priceSatang ?? 1200,
    salesEnabled: true,
  })
  const [mainWarehouse] = await database.db.select({ id: warehouse.id })
    .from(warehouse).where(eq(warehouse.code, 'MAIN'))
  if (!mainWarehouse) throw new Error('Expected MAIN warehouse')
  const quantities = options.quantities ?? [5]
  const lotIds: string[] = []
  for (const [index, quantity] of quantities.entries()) {
    const id = crypto.randomUUID()
    lotIds.push(id)
    const receivedAt = new Date(Date.now() - (quantities.length - index) * 86_400_000)
    await database.db.insert(inventoryLot).values({
      id,
      warehouseId: mainWarehouse.id,
      variantId,
      lotCode: `CHECKOUT-${suffix.slice(0, 8)}-${index}`,
      receivedAt,
      expiryDate: '2999-12-31',
      onHandQuantity: quantity,
    })
  }
  return { productId, variantId, lotIds }
}

async function prepareCheckout(
  principal: CartPrincipal = guestPrincipal(),
  options: { priceSatang?: number; quantities?: number[]; quantity?: number } = {},
) {
  const seeded = await seedVariant(options)
  const { cartService, quote, checkout } = createServices()
  await cartService.setItem(principal, seeded.variantId, options.quantity ?? 2)
  const displayQuote = await quote.create(principal, new Date())
  const input = {
    quoteToken: displayQuote.quoteToken,
    paymentMethod: 'cod' as const,
    contact: { email: '  buyer@example.test ', phone: ' 081-234-5678 ' },
    address: inlineAddress,
  }
  return { ...seeded, principal, input, displayQuote, cartService, checkout }
}

function stripeInput(prepared: Awaited<ReturnType<typeof prepareCheckout>>) {
  return { ...prepared.input, paymentMethod: 'stripe' as const }
}

async function countRows(tableName: 'commerce_order' | 'order_item' | 'order_item_allocation' | 'order_operation' | 'order_outbox' | 'inventory_operation' | 'inventory_reservation' | 'inventory_reservation_allocation' | 'payment' | 'stock_movement' | 'order_event' | 'audit_log' | 'stripe_checkout_attempt') {
  const [row] = await database.db.execute<{ count: number }>(sql`select count(*)::int as count from ${sql.identifier(tableName)}`)
  return Number(row?.count ?? 0)
}

describe('atomic COD checkout', () => {
  it('provides the checkout service for transactional COD order placement', () => {
    expect(CheckoutService).toBeFunction()
  })

  const checkoutBehavior = it

  checkoutBehavior('snapshots an order, allocates FIFO, clears the guest cart, and raises reversible capacity', async () => {
    const prepared = await prepareCheckout(guestPrincipal(), { quantities: [2, 5], quantity: 4 })

    const result = await prepared.checkout.placeCod(prepared.input, prepared.principal, 'checkout-success-1')
    const [savedOrder] = await database.db.select().from(commerceOrder)
      .where(eq(commerceOrder.id, result.order.id))
    const savedItems = await database.db.select().from(orderItem)
      .where(eq(orderItem.orderId, result.order.id))
    const [savedReservation] = await database.db.select().from(inventoryReservation)
      .where(eq(inventoryReservation.id, savedOrder!.reservationId))
    const reservationAllocations = await database.db.select().from(inventoryReservationAllocation)
      .where(eq(inventoryReservationAllocation.reservationId, savedOrder!.reservationId))
    const allocations = await database.db.select({ allocation: orderItemAllocation, receivedAt: inventoryLot.receivedAt })
      .from(orderItemAllocation)
      .innerJoin(inventoryLot, eq(orderItemAllocation.lotId, inventoryLot.id))
      .where(eq(orderItemAllocation.orderId, result.order.id))
      .orderBy(asc(inventoryLot.receivedAt))
    const savedPayment = await database.db.select().from(payment)
      .where(eq(payment.orderId, result.order.id))
    const events = await database.db.select().from(orderEvent)
      .where(eq(orderEvent.orderId, result.order.id))
    const outbox = await database.db.select().from(orderOutbox)
      .where(eq(orderOutbox.orderId, result.order.id))
    const audit = await database.db.select().from(auditLog)
      .where(and(eq(auditLog.action, 'order.placed'), eq(auditLog.targetId, result.order.id)))
    const lots = await database.db.select().from(inventoryLot)
      .where(and(eq(inventoryLot.variantId, prepared.variantId)))
      .orderBy(asc(inventoryLot.receivedAt))

    expect(result.guestAccessToken).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(savedOrder).toMatchObject({
      customerId: null,
      status: 'placed',
      contactEmail: 'buyer@example.test',
      contactPhone: '081-234-5678',
      recipientName: 'Somchai Buyer',
      addressLine1: '12 Orchard Road',
      addressLine2: 'Building A',
      subdistrict: 'Talat Noi',
      district: 'Samphanthawong',
      province: 'Bangkok',
      postalCode: '10100',
      subtotalSatang: 4800,
      shippingSatang: 725,
      totalSatang: 5525,
      paymentMethod: 'cod',
    })
    expect(savedItems).toHaveLength(1)
    expect(savedItems[0]).toMatchObject({
      productId: prepared.productId,
      variantId: prepared.variantId,
      sku: expect.stringMatching(/^CHECKOUT-/),
      productName: 'Checkout Fruit Box',
      variantName: 'Small box',
      unit: 'box',
      unitPriceSatang: 1200,
      quantity: 4,
      lineTotalSatang: 4800,
    })
    expect(allocations.map(({ allocation: { lotId, quantity } }) => ({ lotId, quantity }))).toEqual([
      { lotId: prepared.lotIds[0], quantity: 2 },
      { lotId: prepared.lotIds[1], quantity: 2 },
    ])
    expect(allocations.map(({ allocation }) => allocation.reservationAllocationId).sort())
      .toEqual(reservationAllocations.map(({ id }) => id).sort())
    expect(savedPayment).toHaveLength(1)
    expect(savedPayment[0]).toMatchObject({ method: 'cod', provider: 'cod', status: 'awaiting_collection', amountSatang: 5525 })
    expect(events.map(({ eventType, actorType }) => ({ eventType, actorType }))).toContainEqual({
      eventType: 'order.placed', actorType: 'guest',
    })
    expect(outbox).toHaveLength(1)
    expect(savedReservation?.actorId).toBe(result.order.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actorUserId: null, metadata: {
      actorType: 'guest', principalId: result.order.id, reservationId: savedOrder!.reservationId,
      paymentId: savedPayment[0]!.id, totalSatang: 5525, lineCount: 1,
    } })
    expect(JSON.stringify({ audit, outbox, operationResult: await database.db.select().from(orderOperation) }))
      .not.toContain(result.guestAccessToken)
    expect((await prepared.cartService.get(prepared.principal)).lines).toHaveLength(0)
    expect(lots.map(({ onHandQuantity, reversibleQuantity }) => [onHandQuantity, reversibleQuantity])).toEqual([[0, 2], [3, 2]])
  })

  checkoutBehavior('replays the same order and guest token before checking an expired quote or cleared cart', async () => {
    const principal = guestPrincipal('replay-owner')
    const prepared = await prepareCheckout(principal, { quantity: 1 })
    let now = new Date()
    const service = new CheckoutService(database.db, commerceSecret, () => now)
    const first = await service.placeCod(prepared.input, principal, 'checkout-replay-1')
    now = new Date(now.getTime() + 16 * 60 * 1000)
    await database.db.update(commerceOrder).set({ status: 'processing' })
      .where(eq(commerceOrder.id, first.order.id))

    const replay = await service.placeCod(prepared.input, principal, 'checkout-replay-1')

    expect(replay).toEqual(first)
    expect(replay.order.status).toBe('placed')
    expect(replay.guestAccessToken).toBe(first.guestAccessToken)
    const [currentOrder] = await database.db.select().from(commerceOrder)
      .where(eq(commerceOrder.id, first.order.id))
    expect(currentOrder?.status).toBe('processing')
    expect(await countRows('commerce_order')).toBe(1)
    expect(await countRows('order_operation')).toBe(1)
    expect(await countRows('order_outbox')).toBe(1)
  })

  checkoutBehavior('rejects a COD replay payload corrupted to pending payment', async () => {
    const prepared = await prepareCheckout()
    const key = 'checkout-corrupt-cod-replay'
    await prepared.checkout.placeCod(prepared.input, prepared.principal, key)
    const [operation] = await database.db.select().from(orderOperation)
      .where(eq(orderOperation.idempotencyKey, key))
    const savedPayload = operation!.resultPayload
    const savedOrder = savedPayload.order as Record<string, unknown>
    await database.db.update(orderOperation).set({
      resultPayload: { ...savedPayload, order: { ...savedOrder, status: 'pending_payment' } },
    }).where(eq(orderOperation.id, operation!.id))

    await expect(prepared.checkout.placeCod(prepared.input, prepared.principal, key))
      .rejects.toMatchObject({ code: 'INVALID_ORDER_COMMAND', status: 422 })
  })

  checkoutBehavior('rejects a changed payload on an idempotency-key replay without creating another order', async () => {
    const prepared = await prepareCheckout()
    await prepared.checkout.placeCod(prepared.input, prepared.principal, 'checkout-changed-1')

    await expect(prepared.checkout.placeCod({
      ...prepared.input,
      contact: { ...prepared.input.contact, email: 'other@example.test' },
    }, prepared.principal, 'checkout-changed-1')).rejects.toMatchObject({ code: 'ORDER_OPERATION_CONFLICT', status: 409 })
    expect(await countRows('commerce_order')).toBe(1)
    expect(await countRows('order_outbox')).toBe(1)
  })

  checkoutBehavior('returns a stale quote conflict and no order after a product price change', async () => {
    const prepared = await prepareCheckout()
    await database.db.update(productVariant).set({ priceSatang: 1300 })
      .where(eq(productVariant.id, prepared.variantId))

    await expect(prepared.checkout.placeCod(prepared.input, prepared.principal, 'checkout-stale-price'))
      .rejects.toMatchObject({ code: 'QUOTE_STALE', status: 409 })
    expect(await countRows('commerce_order')).toBe(0)
    expect(await countRows('order_operation')).toBe(0)
    expect(await countRows('inventory_operation')).toBe(0)
    expect(await countRows('inventory_reservation')).toBe(0)
    expect(await countRows('stock_movement')).toBe(0)
    expect(await countRows('payment')).toBe(0)
    expect(await countRows('order_event')).toBe(0)
    expect(await countRows('order_outbox')).toBe(0)
    expect((await prepared.cartService.get(prepared.principal)).lines).toHaveLength(1)
  })

  checkoutBehavior('returns a stale quote conflict and no order after a shipping fee change', async () => {
    const prepared = await prepareCheckout()
    await database.db.update(commerceSettings).set({ shippingFeeSatang: 900, version: 3 })
      .where(eq(commerceSettings.id, 1))

    await expect(prepared.checkout.placeCod(prepared.input, prepared.principal, 'checkout-stale-fee'))
      .rejects.toMatchObject({ code: 'QUOTE_STALE', status: 409 })
    expect(await countRows('commerce_order')).toBe(0)
    expect(await countRows('order_operation')).toBe(0)
    expect(await countRows('inventory_operation')).toBe(0)
    expect(await countRows('inventory_reservation')).toBe(0)
    expect(await countRows('stock_movement')).toBe(0)
    expect(await countRows('payment')).toBe(0)
    expect(await countRows('order_event')).toBe(0)
    expect(await countRows('order_outbox')).toBe(0)
    expect((await prepared.cartService.get(prepared.principal)).lines).toHaveLength(1)
  })

  checkoutBehavior('rolls back order, inventory, payment, event, audit, outbox, and cart writes on downstream insert failures', async () => {
    const prepared = await prepareCheckout()
    const originalCart = await prepared.cartService.get(prepared.principal)
    const originalLots = await database.db.select({
      id: inventoryLot.id,
      onHandQuantity: inventoryLot.onHandQuantity,
      reservedQuantity: inventoryLot.reservedQuantity,
      reversibleQuantity: inventoryLot.reversibleQuantity,
    }).from(inventoryLot).where(eq(inventoryLot.variantId, prepared.variantId))
    const rejectingTargets = [
      {
        name: 'fail_checkout_payment',
        table: 'payment',
        statement: `create trigger fail_checkout_payment before insert on payment for each row execute function reject_checkout_write()`,
      },
      {
        name: 'fail_checkout_outbox',
        table: 'order_outbox',
        statement: `create trigger fail_checkout_outbox before insert on order_outbox for each row execute function reject_checkout_write()`,
      },
      {
        name: 'fail_checkout_audit',
        table: 'audit_log',
        statement: `create trigger fail_checkout_audit before insert on audit_log for each row when (new.action = 'order.placed') execute function reject_checkout_write()`,
      },
      {
        name: 'fail_checkout_operation',
        table: 'order_operation',
        statement: `create trigger fail_checkout_operation before insert on order_operation for each row execute function reject_checkout_write()`,
      },
    ]
    await database.db.execute(sql`create function reject_checkout_write() returns trigger language plpgsql as $$ begin raise exception 'CHECKOUT_WRITE_REJECTED'; end $$`)
    try {
      for (const target of rejectingTargets) {
        await database.db.execute(sql.raw(target.statement))
        await expect(prepared.checkout.placeCod(prepared.input, prepared.principal, `checkout-rollback-${crypto.randomUUID()}`))
          .rejects.toBeTruthy()
        expect(await countRows('commerce_order')).toBe(0)
        expect(await countRows('order_item')).toBe(0)
        expect(await countRows('order_item_allocation')).toBe(0)
        expect(await countRows('inventory_reservation')).toBe(0)
        expect(await countRows('inventory_reservation_allocation')).toBe(0)
        expect(await countRows('inventory_operation')).toBe(0)
        expect(await countRows('order_operation')).toBe(0)
        expect(await countRows('stock_movement')).toBe(0)
        expect(await countRows('payment')).toBe(0)
        expect(await countRows('order_event')).toBe(0)
        expect(await countRows('order_outbox')).toBe(0)
        expect(await countRows('audit_log')).toBe(0)
        const cartAfterFailure = await prepared.cartService.get(prepared.principal)
        expect(cartAfterFailure.cartVersion).toBe(originalCart.cartVersion)
        expect(cartAfterFailure.lines).toEqual(originalCart.lines)
        const lotsAfterFailure = await database.db.select({
          id: inventoryLot.id,
          onHandQuantity: inventoryLot.onHandQuantity,
          reservedQuantity: inventoryLot.reservedQuantity,
          reversibleQuantity: inventoryLot.reversibleQuantity,
        }).from(inventoryLot).where(eq(inventoryLot.variantId, prepared.variantId))
        expect(lotsAfterFailure).toEqual(originalLots)
        await database.db.execute(sql.raw(`drop trigger ${target.name} on ${target.table}`))
      }
    } finally {
      await database.db.execute(sql`drop trigger if exists fail_checkout_payment on payment`)
      await database.db.execute(sql`drop trigger if exists fail_checkout_outbox on order_outbox`)
      await database.db.execute(sql`drop trigger if exists fail_checkout_audit on audit_log`)
      await database.db.execute(sql`drop trigger if exists fail_checkout_operation on order_operation`)
      await database.db.execute(sql`drop function if exists reject_checkout_write()`)
    }
  })

  checkoutBehavior('snapshots only a customer-owned saved address', async () => {
    const principal = { kind: 'customer', userId: actorId } as const
    const prepared = await prepareCheckout(principal, { quantity: 1 })
    const addressId = crypto.randomUUID()
    await database.db.insert(customerAddress).values({
      id: addressId,
      userId: actorId,
      label: 'Home',
      recipientName: 'Saved Buyer',
      phone: '0812345678',
      addressLine1: '9 Saved Road',
      addressLine2: null,
      subdistrict: 'Bang Rak',
      district: 'Bang Rak',
      province: 'Bangkok',
      postalCode: '10500',
      country: 'TH',
    })

    const result = await prepared.checkout.placeCod({
      ...prepared.input,
      address: { addressId },
    }, principal, 'checkout-saved-address-1')
    const [savedOrder] = await database.db.select().from(commerceOrder)
      .where(eq(commerceOrder.id, result.order.id))

    expect(savedOrder).toMatchObject({
      customerId: actorId,
      recipientName: 'Saved Buyer',
      contactPhone: '081-234-5678',
      addressLine1: '9 Saved Road',
      district: 'Bang Rak',
      postalCode: '10500',
    })
  })

  checkoutBehavior('does not snapshot another customer’s saved address', async () => {
    const principal = { kind: 'customer', userId: actorId } as const
    const prepared = await prepareCheckout(principal, { quantity: 1 })
    const otherPrincipal = await createCustomer('checkout-address-owner')
    const addressId = crypto.randomUUID()
    await database.db.insert(customerAddress).values({
      id: addressId,
      userId: otherPrincipal.userId,
      label: 'Private',
      recipientName: 'Other Buyer',
      phone: '0812345678',
      addressLine1: 'Private Road',
      addressLine2: null,
      subdistrict: 'Bang Rak',
      district: 'Bang Rak',
      province: 'Bangkok',
      postalCode: '10500',
      country: 'TH',
    })

    await expect(prepared.checkout.placeCod({
      ...prepared.input,
      address: { addressId },
    }, principal, 'checkout-foreign-address-1'))
      .rejects.toMatchObject({ code: 'ORDER_ADDRESS_NOT_FOUND', status: 404 })
    expect(await countRows('commerce_order')).toBe(0)
    expect((await prepared.cartService.get(principal)).lines).toHaveLength(1)
  })

  checkoutBehavior('lets only one customer place an order for the final eligible unit', async () => {
    const firstPrincipal = { kind: 'customer', userId: actorId } as const
    const secondPrincipal = await createCustomer('checkout-race-customer')
    const seeded = await seedVariant({ quantities: [1], quantity: 1 })
    const { cartService, quote } = createServices()
    await cartService.setItem(firstPrincipal, seeded.variantId, 1)
    await cartService.setItem(secondPrincipal, seeded.variantId, 1)
    const [firstQuote, secondQuote] = await Promise.all([
      quote.create(firstPrincipal, new Date()),
      quote.create(secondPrincipal, new Date()),
    ])
    const checkout = new CheckoutService(database.db, commerceSecret)
    const makeInput = (quoteToken: string) => ({
      quoteToken,
      paymentMethod: 'cod' as const,
      contact: { email: 'buyer@example.test', phone: '0812345678' },
      address: inlineAddress,
    })

    const results = await Promise.allSettled([
      checkout.placeCod(makeInput(firstQuote.quoteToken), firstPrincipal, 'checkout-race-a'),
      checkout.placeCod(makeInput(secondQuote.quoteToken), secondPrincipal, 'checkout-race-b'),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    const rejected = results.find(({ status }) => status === 'rejected')
    expect(rejected).toMatchObject({ reason: { code: 'INVENTORY_STOCK_CONFLICT', status: 409 } })
    expect(await countRows('commerce_order')).toBe(1)
    const [lot] = await database.db.select().from(inventoryLot)
      .where(eq(inventoryLot.variantId, seeded.variantId))
    expect(lot).toMatchObject({ onHandQuantity: 0, reversibleQuantity: 1 })
    expect(await database.db.select().from(stockMovement).where(eq(stockMovement.type, 'reservation_confirm'))).toHaveLength(1)
  })
})

describe('pending Stripe order placement', () => {
  it('stores a pending order and confirmed allocation without queuing confirmation before payment', async () => {
    const prepared = await prepareCheckout(undefined, { quantity: 1 })
    const stripePayments = new StripePaymentRepository(database.db)
    const placeOrderInTransaction = createPlaceOrderInTransaction(commerceSecret, stripePayments)
    const normalized = normalizeCheckoutInput(stripeInput(prepared))

    const record = await database.db.transaction((tx) =>
      placeOrderInTransaction(tx, normalized, prepared.principal, 'a'.repeat(64), 'stripe'))
    const [savedOrder] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, record.order.id))
    const savedPayment = await database.db.select().from(payment).where(eq(payment.orderId, record.order.id))
    const attempts = await database.db.select().from(stripeCheckoutAttempt).where(eq(stripeCheckoutAttempt.orderId, record.order.id))
    const allocations = await database.db.select().from(orderItemAllocation).where(eq(orderItemAllocation.orderId, record.order.id))
    const outbox = await database.db.select().from(orderOutbox).where(eq(orderOutbox.orderId, record.order.id))
    const [lot] = await database.db.select().from(inventoryLot).where(eq(inventoryLot.variantId, prepared.variantId))

    expect(record.order.status).toBe('pending_payment')
    expect(record.order.paymentMethod).toBe('stripe')
    expect(record.paymentId).toBe(savedPayment[0]?.id)
    expect(record.attemptId).toBe(attempts[0]?.id)
    expect(savedOrder?.status).toBe('pending_payment')
    expect(savedPayment).toHaveLength(1)
    expect(savedPayment[0]).toMatchObject({ method: 'stripe', provider: 'stripe', status: 'awaiting_collection', amountSatang: 1925 })
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({ stripeSessionId: null, checkoutUrl: null, status: 'creating' })
    expect(allocations).toHaveLength(1)
    expect(outbox).toHaveLength(0)
    expect(lot?.onHandQuantity).toBe(4)
    expect(lot?.reversibleQuantity).toBe(1)
    expect((await prepared.cartService.get(prepared.principal)).lines).toHaveLength(0)
  })
})
