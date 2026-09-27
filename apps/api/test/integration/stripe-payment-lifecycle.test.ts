import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  commerceOrder,
  commerceSettings,
  inventoryLot,
  orderEvent,
  orderOutbox,
  payment,
  product,
  productVariant,
  stockMovement,
  stripeCheckoutAttempt,
  user,
  warehouse,
} from '../../src/database/schema'
import { CartRepository } from '../../src/modules/cart/repository'
import { CartService } from '../../src/modules/cart/service'
import type { CartPrincipal } from '../../src/modules/cart/types'
import { QuoteService } from '../../src/modules/checkout/quote'
import { StripeCheckoutService } from '../../src/modules/checkout/stripe-service'
import type { CheckoutSessionState, StripeGateway } from '../../src/modules/payments/stripe/gateway'
import { StripeEventService } from '../../src/modules/payments/stripe/events'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'
import { CommerceSettingsRepository } from '../../src/modules/commerce-settings/repository'
import { CommerceSettingsService } from '../../src/modules/commerce-settings/service'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'

const database = createTestDatabase()
const secret = new Uint8Array(32).fill(19)
const actorId = 'stripe-lifecycle-owner'
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
  await database.db.insert(user).values({
    id: actorId,
    name: 'Stripe Lifecycle Customer',
    email: 'stripe-lifecycle@example.test',
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

const address = {
  recipientName: 'Somchai Buyer',
  addressLine1: '12 Orchard Road',
  subdistrict: 'Talat Noi',
  district: 'Samphanthawong',
  province: 'Bangkok',
  postalCode: '10100',
}

function makeGateway(options: {
  session?: CheckoutSessionState
  onRetrieve?: (sessionId: string) => void
} = {}): StripeGateway {
  return {
    createCheckout: async ({ orderId }) => ({
      sessionId: `cs_test_${orderId.replaceAll('-', '')}`,
      url: `https://checkout.stripe.com/c/pay/cs_test_${orderId.replaceAll('-', '')}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }),
    retrieveCheckout: async (sessionId) => {
      options.onRetrieve?.(sessionId)
      if (!options.session) throw new Error('Unexpected Checkout retrieval')
      return { ...options.session, sessionId }
    },
    createFullRefund: async () => { throw new Error('not used') },
    retrieveRefund: async () => { throw new Error('not used') },
    constructEvent(rawBody, signature) {
      if (signature !== 'valid-signature') throw new Error('Invalid signature')
      return JSON.parse(rawBody) as StripeGatewayEvent
    },
  }
}

type StripeGatewayEvent = ReturnType<StripeGateway['constructEvent']>

function event(eventId: string, type: string, session: Record<string, unknown>) {
  return {
    id: eventId,
    object: 'event',
    api_version: '2026-08-26.dahlia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
    data: { object: session },
  } as unknown as StripeGatewayEvent
}

async function preparePendingOrder() {
  const suffix = crypto.randomUUID()
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  const lotId = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId,
    slug: `stripe-lifecycle-${suffix}`,
    name: 'Checkout Fruit Box',
    category: 'fresh',
    status: 'published',
  })
  await database.db.insert(productVariant).values({
    id: variantId,
    productId,
    sku: `STRIPE-${suffix}`,
    name: 'Small box',
    unit: 'box',
    priceSatang: 1200,
    salesEnabled: true,
  })
  const [mainWarehouse] = await database.db.select({ id: warehouse.id }).from(warehouse)
    .where(eq(warehouse.code, 'MAIN'))
  if (!mainWarehouse) throw new Error('Expected MAIN warehouse')
  await database.db.insert(inventoryLot).values({
    id: lotId,
    warehouseId: mainWarehouse.id,
    variantId,
    lotCode: `STRIPE-${suffix.slice(0, 8)}`,
    receivedAt: new Date(Date.now() - 86_400_000),
    expiryDate: '2999-12-31',
    onHandQuantity: 5,
  })

  const principal: CartPrincipal = {
    kind: 'guest',
    tokenHash: createHash('sha256').update(crypto.randomUUID()).digest('hex'),
  }
  const audit = new AuditService(new AuditRepository(database.db))
  const settings = new CommerceSettingsService(new CommerceSettingsRepository(database.db, audit))
  const cartService = new CartService(new CartRepository(database.db, new InventoryReadRepository(database.db)))
  const quote = new QuoteService(cartService, settings, secret)
  await cartService.setItem(principal, variantId, 1)
  const quoteResult = await quote.create(principal, new Date())
  const checkout = new StripeCheckoutService(database.db, secret, makeGateway())
  const result = await checkout.place({
    quoteToken: quoteResult.quoteToken,
    paymentMethod: 'stripe',
    contact: { email: 'buyer@example.test', phone: '081-234-5678' },
    address,
  }, principal, `stripe-lifecycle-${suffix}`)
  const [attempt] = await database.db.select().from(stripeCheckoutAttempt)
    .where(eq(stripeCheckoutAttempt.orderId, result.order.id))
  if (!attempt?.stripeSessionId) throw new Error('Expected a persisted Stripe Checkout Session')
  return { orderId: result.order.id, sessionId: attempt.stripeSessionId, variantId, lotId, amount: 1925 }
}

function sessionFor(fixture: Awaited<ReturnType<typeof preparePendingOrder>>, values: Record<string, unknown> = {}) {
  return {
    id: fixture.sessionId,
    object: 'checkout.session',
    client_reference_id: fixture.orderId,
    metadata: { orderId: fixture.orderId },
    amount_total: fixture.amount,
    currency: 'thb',
    payment_status: 'paid',
    status: 'complete',
    payment_intent: 'pi_test_lifecycle',
    ...values,
  }
}

async function sendEvent(gateway: StripeGateway, eventId: string, type: string, session: Record<string, unknown>) {
  const service = new StripeEventService(database.db, gateway)
  await service.handle(JSON.stringify(event(eventId, type, session)), 'valid-signature')
}

describe('Stripe payment lifecycle', () => {
  it('collects payment and queues one confirmation across duplicate event delivery', async () => {
    const fixture = await preparePendingOrder()
    const gateway = makeGateway()
    const session = sessionFor(fixture)

    await sendEvent(gateway, 'evt_paidonce', 'checkout.session.completed', session)
    await sendEvent(gateway, 'evt_paidonce', 'checkout.session.completed', session)

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [savedPayment] = await database.db.select().from(payment).where(eq(payment.orderId, fixture.orderId))
    const events = await database.db.select().from(orderEvent).where(eq(orderEvent.orderId, fixture.orderId))
    const outbox = await database.db.select().from(orderOutbox).where(eq(orderOutbox.orderId, fixture.orderId))
    expect(order?.status).toBe('placed')
    expect(savedPayment?.status).toBe('collected')
    expect(events.filter(({ eventType }) => eventType === 'order.placed')).toHaveLength(1)
    expect(outbox).toHaveLength(1)
  })

  it('keeps an unpaid completed Session pending with its allocation held', async () => {
    const fixture = await preparePendingOrder()
    await sendEvent(makeGateway(), 'evt_unpaidcomplete', 'checkout.session.completed', sessionFor(fixture, {
      payment_status: 'unpaid',
    }))

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [savedPayment] = await database.db.select().from(payment).where(eq(payment.orderId, fixture.orderId))
    const [attempt] = await database.db.select().from(stripeCheckoutAttempt)
      .where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))
    const [lot] = await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, fixture.lotId))
    expect(order?.status).toBe('pending_payment')
    expect(savedPayment?.status).toBe('awaiting_collection')
    expect(attempt?.status).toBe('open')
    expect(lot).toMatchObject({ onHandQuantity: 4, reversibleQuantity: 1 })
  })

  it('places an asynchronously paid order', async () => {
    const fixture = await preparePendingOrder()
    await sendEvent(makeGateway(), 'evt_asyncpaid', 'checkout.session.async_payment_succeeded', sessionFor(fixture))

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    expect(order?.status).toBe('placed')
    expect(await database.db.select().from(orderOutbox).where(eq(orderOutbox.orderId, fixture.orderId))).toHaveLength(1)
  })

  it('binds and settles a paid Session delivered before its ID was persisted', async () => {
    const fixture = await preparePendingOrder()
    await database.db.update(stripeCheckoutAttempt).set({
      stripeSessionId: null,
      checkoutUrl: null,
      expiresAt: null,
      status: 'creating',
    }).where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))

    await sendEvent(makeGateway(), 'evt_earlypaid', 'checkout.session.completed', sessionFor(fixture, {
      url: `https://checkout.stripe.com/c/pay/${fixture.sessionId}`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    }))

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [attempt] = await database.db.select().from(stripeCheckoutAttempt)
      .where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))
    expect(order?.status).toBe('placed')
    expect(attempt).toMatchObject({ stripeSessionId: fixture.sessionId, status: 'completed' })
  })

  it.each([
    ['checkout.session.async_payment_failed', 'complete', 'unpaid'],
    ['checkout.session.expired', 'expired', 'unpaid'],
  ] as const)('cancels and restores once for %s', async (type, status, paymentStatus) => {
    const fixture = await preparePendingOrder()
    const session = sessionFor(fixture, { status, payment_status: paymentStatus })
    const gateway = makeGateway({ session: {
      sessionId: fixture.sessionId,
      orderId: fixture.orderId,
      amountSatang: fixture.amount,
      currency: 'thb',
      status,
      paymentStatus,
      paymentIntentId: 'pi_test_lifecycle',
      expiresAt: null,
    } })

    await sendEvent(gateway, 'evt_terminalonce', type, session)
    await sendEvent(gateway, 'evt_terminaltwice', type, session)

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [savedPayment] = await database.db.select().from(payment).where(eq(payment.orderId, fixture.orderId))
    const [lot] = await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, fixture.lotId))
    const restores = await database.db.select().from(stockMovement)
      .where(eq(stockMovement.type, 'order_cancel_restore'))
    expect(order?.status).toBe('cancelled')
    expect(savedPayment?.status).toBe('void')
    expect(lot).toMatchObject({ onHandQuantity: 5, reversibleQuantity: 0 })
    expect(restores).toHaveLength(1)
  })

  it('does not let an out-of-order stale failure undo a paid order', async () => {
    const fixture = await preparePendingOrder()
    const paid = sessionFor(fixture)
    await sendEvent(makeGateway(), 'evt_paidfirst', 'checkout.session.async_payment_succeeded', paid)
    const gateway = makeGateway({ session: {
      sessionId: fixture.sessionId,
      orderId: fixture.orderId,
      amountSatang: fixture.amount,
      currency: 'thb',
      status: 'complete',
      paymentStatus: 'paid',
      paymentIntentId: 'pi_test_lifecycle',
      expiresAt: null,
    } })
    await sendEvent(gateway, 'evt_stalefailure', 'checkout.session.async_payment_failed', sessionFor(fixture, {
      status: 'complete', payment_status: 'unpaid',
    }))

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [savedPayment] = await database.db.select().from(payment).where(eq(payment.orderId, fixture.orderId))
    expect(order?.status).toBe('placed')
    expect(savedPayment?.status).toBe('collected')
    expect(await database.db.select().from(orderOutbox).where(eq(orderOutbox.orderId, fixture.orderId))).toHaveLength(1)
  })

  it.each([
    ['Session ID', { id: 'cs_test_other' }],
    ['order ID', { client_reference_id: '00000000-0000-4000-8000-000000000099' }],
    ['amount', { amount_total: 1926 }],
    ['currency', { currency: 'usd' }],
  ])('ignores a paid event with mismatched %s', async (_label, mismatch) => {
    const fixture = await preparePendingOrder()
    await sendEvent(makeGateway(), `evt_mismatch${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`,
      'checkout.session.completed', sessionFor(fixture, mismatch))

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [savedPayment] = await database.db.select().from(payment).where(eq(payment.orderId, fixture.orderId))
    expect(order?.status).toBe('pending_payment')
    expect(savedPayment?.status).toBe('awaiting_collection')
    expect(await database.db.select().from(orderOutbox).where(eq(orderOutbox.orderId, fixture.orderId))).toHaveLength(0)
  })

  it.each(['open', 'complete'] as const)('keeps an unresolved %s Session allocated during reconciliation', async (status) => {
    const fixture = await preparePendingOrder()
    const service = new StripeEventService(database.db, makeGateway({ session: {
      sessionId: fixture.sessionId,
      orderId: fixture.orderId,
      amountSatang: fixture.amount,
      currency: 'thb',
      status,
      paymentStatus: 'unpaid',
      paymentIntentId: null,
      expiresAt: null,
    } }))

    expect(await service.reconcileAttempts(10)).toBe(1)
    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [lot] = await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, fixture.lotId))
    expect(order?.status).toBe('pending_payment')
    const [attempt] = await database.db.select().from(stripeCheckoutAttempt)
      .where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))
    expect(attempt?.status).toBe('open')
    expect(lot).toMatchObject({ onHandQuantity: 4, reversibleQuantity: 1 })
  })

  it('cancels an expired confirmed Session during reconciliation', async () => {
    const fixture = await preparePendingOrder()
    const service = new StripeEventService(database.db, makeGateway({ session: {
      sessionId: fixture.sessionId,
      orderId: fixture.orderId,
      amountSatang: fixture.amount,
      currency: 'thb',
      status: 'expired',
      paymentStatus: 'unpaid',
      paymentIntentId: null,
      expiresAt: new Date(Date.now() - 1000),
    } }))

    expect(await service.reconcileAttempts(10)).toBe(1)
    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [savedPayment] = await database.db.select().from(payment).where(eq(payment.orderId, fixture.orderId))
    const [lot] = await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, fixture.lotId))
    expect(order?.status).toBe('cancelled')
    expect(savedPayment?.status).toBe('void')
    expect(lot).toMatchObject({ onHandQuantity: 5, reversibleQuantity: 0 })
  })
})
