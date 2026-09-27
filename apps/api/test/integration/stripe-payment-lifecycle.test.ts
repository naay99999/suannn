import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  commerceOrder,
  commerceSettings,
  inventoryLot,
  inventoryReservation,
  orderEvent,
  orderOutbox,
  payment,
  product,
  productVariant,
  stockMovement,
  stripeCheckoutAttempt,
  stripeRefund,
  user,
  warehouse,
} from '../../src/database/schema'
import { CartRepository } from '../../src/modules/cart/repository'
import { CartService } from '../../src/modules/cart/service'
import type { CartPrincipal } from '../../src/modules/cart/types'
import { QuoteService } from '../../src/modules/checkout/quote'
import { StripeCheckoutService } from '../../src/modules/checkout/stripe-service'
import type { CheckoutSessionState, StripeGateway, StripeRefundState } from '../../src/modules/payments/stripe/gateway'
import { StripeEventService } from '../../src/modules/payments/stripe/events'
import { StripeRefundService } from '../../src/modules/payments/stripe/refunds'
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
  retrieve?: (sessionId: string) => Promise<CheckoutSessionState>
  onCreate?: (input: Parameters<StripeGateway['createCheckout']>[0]) => Promise<Awaited<ReturnType<StripeGateway['createCheckout']>>>
  retrieveRefund?: (refundId: string) => Promise<StripeRefundState>
} = {}): StripeGateway {
  return {
    checkoutReturnUrls: () => ({ successUrl: 'https://shop.example.test/success?session_id={CHECKOUT_SESSION_ID}', cancelUrl: 'https://shop.example.test/cancel' }),
    createCheckout: async (input) => options.onCreate?.(input) ?? {
      sessionId: `cs_test_${input.orderId.replaceAll('-', '')}`,
      url: `https://checkout.stripe.com/c/pay/cs_test_${input.orderId.replaceAll('-', '')}`,
      expiresAt: input.expiresAt,
    },
    retrieveCheckout: async (sessionId) => {
      options.onRetrieve?.(sessionId)
      if (options.retrieve) return options.retrieve(sessionId)
      if (!options.session) throw new Error('Unexpected Checkout retrieval')
      return { ...options.session, sessionId }
    },
    createFullRefund: async () => { throw new Error('not used') },
    retrieveRefund: async (refundId) => options.retrieveRefund
      ? options.retrieveRefund(refundId)
      : Promise.reject(new Error('not used')),
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

  it('binds an early paid Session even when Stripe omits its Checkout URL', async () => {
    const fixture = await preparePendingOrder()
    await database.db.update(stripeCheckoutAttempt).set({
      stripeSessionId: null,
      checkoutUrl: null,
      expiresAt: null,
      status: 'creating',
    }).where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))

    await sendEvent(makeGateway(), 'evt_earlypaidnourl', 'checkout.session.completed', sessionFor(fixture, {
      url: null,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    }))

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [attempt] = await database.db.select().from(stripeCheckoutAttempt)
      .where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))
    expect(order?.status).toBe('placed')
    expect(attempt).toMatchObject({
      stripeSessionId: fixture.sessionId,
      checkoutUrl: null,
      status: 'completed',
    })
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

  it('keeps an unbound attempt allocated through its planned expiry and bounded create-call window', async () => {
    const fixture = await preparePendingOrder()
    const lastCreateCallAt = new Date(Date.now() - 33 * 60 * 1000)
    const plannedExpiry = new Date(lastCreateCallAt.getTime() + 34 * 60 * 1000)
    await database.db.update(stripeCheckoutAttempt).set({
      stripeSessionId: null,
      checkoutUrl: null,
      expiresAt: null,
      status: 'creating',
      lastCreateCallAt,
      plannedExpiresAt: plannedExpiry,
    }).where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))

    const service = new StripeEventService(database.db, makeGateway())
    await service.reconcileAttempts(10)

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [lot] = await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, fixture.lotId))
    expect(order?.status).toBe('pending_payment')
    expect(lot).toMatchObject({ onHandQuantity: 4, reversibleQuantity: 1 })
  })

  it('continues reconciling the batch when retrieving an earlier Session fails', async () => {
    const failing = await preparePendingOrder()
    const healthy = await preparePendingOrder()
    const gateway = makeGateway({
      retrieve: async (sessionId) => {
        if (sessionId === failing.sessionId) throw new Error('Stripe read unavailable')
        return {
          sessionId,
          orderId: healthy.orderId,
          amountSatang: healthy.amount,
          currency: 'thb',
          status: 'complete',
          paymentStatus: 'paid',
          paymentIntentId: 'pi_healthy_batch',
          expiresAt: null,
        }
      },
    })

    expect(await new StripeEventService(database.db, gateway).reconcileAttempts(2)).toBe(1)

    const [failingOrder] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, failing.orderId))
    const [healthyOrder] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, healthy.orderId))
    expect(failingOrder?.status).toBe('pending_payment')
    expect(healthyOrder?.status).toBe('placed')
  })

  it('rotates failed Checkout and refund reads beyond the 100-record batch', async () => {
    const fixture = await preparePendingOrder()
    const [baseOrder] = await database.db.select().from(commerceOrder)
      .where(eq(commerceOrder.id, fixture.orderId))
    const [baseReservation] = await database.db.select().from(inventoryReservation)
      .where(eq(inventoryReservation.id, baseOrder!.reservationId))
    if (!baseOrder || !baseReservation) throw new Error('Expected seeded order and reservation')

    const syntheticCount = 101
    const now = Date.now()
    const reservations = []
    const orders = []
    const payments = []
    const attempts = []
    const refunds = []
    const sessionIds: string[] = []
    const refundIds: string[] = []
    for (let index = 0; index < syntheticCount; index += 1) {
      const id = crypto.randomUUID()
      const reservationId = crypto.randomUUID()
      const paymentId = crypto.randomUUID()
      const attemptId = crypto.randomUUID()
      const refundClaimId = crypto.randomUUID()
      const sessionId = `cs_test_rotation${index}`
      const refundId = `re_rotation${index}`
      const createdAt = new Date(now - (syntheticCount - index) * 1000)
      reservations.push({
        id: reservationId,
        warehouseId: baseReservation.warehouseId,
        externalReference: null,
        status: 'confirmed' as const,
        createdAt,
        expiresAt: new Date(now + 86_400_000),
        completedAt: createdAt,
        actorId: 'batch-rotation-test',
      })
      orders.push({
        id,
        orderNumber: `ROT-${id.replaceAll('-', '')}`,
        customerId: null,
        guestAccessTokenHash: 'a'.repeat(64),
        guestAccessTokenNonce: `rotation-${id}`,
        guestAccessTokenVersion: 1,
        contactEmail: 'rotation@example.test',
        contactPhone: '081-234-5678',
        recipientName: 'Rotation Test',
        addressLine1: '1 Main Road',
        addressLine2: null,
        subdistrict: 'Talat Noi',
        district: 'Samphanthawong',
        province: 'Bangkok',
        postalCode: '10100',
        subtotalSatang: 1200,
        shippingSatang: 725,
        totalSatang: 1925,
        currency: 'THB',
        paymentMethod: 'stripe',
        status: 'pending_payment' as const,
        reservationId,
        quoteFingerprint: 'b'.repeat(64),
        createdAt,
        updatedAt: createdAt,
      })
      payments.push({
        id: paymentId,
        orderId: id,
        method: 'stripe',
        provider: 'stripe',
        amountSatang: 1925,
        currency: 'THB',
        status: 'awaiting_collection' as const,
        providerReference: `pi_rotation${index}`,
      })
      attempts.push({
        id: attemptId,
        orderId: id,
        stripeSessionId: sessionId,
        checkoutUrl: `https://checkout.stripe.com/c/pay/${sessionId}`,
        expiresAt: new Date(now + 30 * 60 * 1000),
        plannedExpiresAt: new Date(now + 30 * 60 * 1000),
        successUrl: 'https://shop.example.test/success',
        cancelUrl: 'https://shop.example.test/cancel',
        stripeIdempotencyKey: `rotation-attempt-${id}`,
        status: 'open' as const,
        lastCreateCallAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      })
      refunds.push({
        id: refundClaimId,
        paymentId,
        orderId: id,
        requestActorType: 'system' as const,
        requestActorId: null,
        idempotencyKey: `rotation-refund-${index}`,
        stripeIdempotencyKey: `stripe-rotation-refund-${index}`,
        stripeRefundId: refundId,
        amountSatang: 1925,
        status: 'pending' as const,
        createdAt,
        updatedAt: createdAt,
      })
    }
    await database.db.insert(inventoryReservation).values(reservations)
    await database.db.insert(commerceOrder).values(orders)
    await database.db.insert(payment).values(payments)
    await database.db.insert(stripeCheckoutAttempt).values(attempts)
    await database.db.insert(stripeRefund).values(refunds)

    const gateway = makeGateway({
      retrieve: async (sessionId) => {
        sessionIds.push(sessionId)
        throw new Error('temporary Session read failure')
      },
      retrieveRefund: async (refundId) => {
        refundIds.push(refundId)
        throw new Error('temporary Refund read failure')
      },
    })
    const logError = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const events = new StripeEventService(database.db, gateway)
      expect(await events.reconcileAttempts(100)).toBe(0)
      expect(await events.reconcileAttempts(100)).toBe(0)
      expect(new Set(sessionIds).size).toBe(syntheticCount + 1)

      const refundsService = new StripeRefundService(database.db, gateway)
      expect(await refundsService.reconcileRefunds(100)).toBe(0)
      expect(await refundsService.reconcileRefunds(100)).toBe(0)
      expect(new Set(refundIds).size).toBe(syntheticCount)
    } finally {
      logError.mockRestore()
    }
  })

  it('recovers an expired unpaid Session with the original fixed create request before releasing stock', async () => {
    const fixture = await preparePendingOrder()
    const lastCreateCallAt = new Date(Date.now() - 37 * 60 * 1000)
    const plannedExpiry = new Date(lastCreateCallAt.getTime() + 34 * 60 * 1000)
    await database.db.update(stripeCheckoutAttempt).set({
      stripeSessionId: null,
      checkoutUrl: null,
      expiresAt: null,
      status: 'creating',
      lastCreateCallAt,
      plannedExpiresAt: plannedExpiry,
    }).where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))

    let recoveredInput: Parameters<StripeGateway['createCheckout']>[0] | undefined
    const service = new StripeEventService(database.db, makeGateway({
      onCreate: async (input) => {
        recoveredInput = input
        return {
          sessionId: fixture.sessionId,
          url: `https://checkout.stripe.com/c/pay/${fixture.sessionId}`,
          expiresAt: plannedExpiry,
        }
      },
      session: {
        sessionId: fixture.sessionId,
        orderId: fixture.orderId,
        amountSatang: fixture.amount,
        currency: 'thb',
        status: 'expired',
        paymentStatus: 'unpaid',
        paymentIntentId: null,
        expiresAt: plannedExpiry,
      },
    }))
    await service.reconcileAttempts(10)

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [savedPayment] = await database.db.select().from(payment).where(eq(payment.orderId, fixture.orderId))
    const [attempt] = await database.db.select().from(stripeCheckoutAttempt)
      .where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))
    const [lot] = await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, fixture.lotId))
    expect(recoveredInput).toMatchObject({
      orderId: fixture.orderId,
      expiresAt: plannedExpiry,
      successUrl: 'https://shop.example.test/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://shop.example.test/cancel',
      idempotencyKey: attempt?.stripeIdempotencyKey,
    })
    expect(order?.status).toBe('cancelled')
    expect(savedPayment?.status).toBe('void')
    expect(attempt?.status).toBe('expired')
    expect(lot).toMatchObject({ onHandQuantity: 5, reversibleQuantity: 0 })
  })

  it('settles a paid Session recovered from the original idempotent create request', async () => {
    const fixture = await preparePendingOrder()
    const lastCreateCallAt = new Date(Date.now() - 37 * 60 * 1000)
    const plannedExpiry = new Date(lastCreateCallAt.getTime() + 34 * 60 * 1000)
    await database.db.update(stripeCheckoutAttempt).set({
      stripeSessionId: null,
      checkoutUrl: null,
      expiresAt: null,
      status: 'creating',
      lastCreateCallAt,
      plannedExpiresAt: plannedExpiry,
    }).where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))

    const service = new StripeEventService(database.db, makeGateway({
      onCreate: async () => ({
        sessionId: fixture.sessionId,
        url: `https://checkout.stripe.com/c/pay/${fixture.sessionId}`,
        expiresAt: plannedExpiry,
      }),
      session: {
        sessionId: fixture.sessionId,
        orderId: fixture.orderId,
        amountSatang: fixture.amount,
        currency: 'thb',
        status: 'complete',
        paymentStatus: 'paid',
        paymentIntentId: 'pi_recovered_paid',
        expiresAt: plannedExpiry,
      },
    }))
    await service.reconcileAttempts(10)

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [savedPayment] = await database.db.select().from(payment).where(eq(payment.orderId, fixture.orderId))
    const [attempt] = await database.db.select().from(stripeCheckoutAttempt)
      .where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))
    const [lot] = await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, fixture.lotId))
    expect(order?.status).toBe('placed')
    expect(savedPayment?.status).toBe('collected')
    expect(attempt?.status).toBe('completed')
    expect(lot).toMatchObject({ onHandQuantity: 4, reversibleQuantity: 1 })
  })

  it('keeps stock allocated and marks manual review when unbound create recovery is ambiguous', async () => {
    const fixture = await preparePendingOrder()
    const lastCreateCallAt = new Date(Date.now() - 37 * 60 * 1000)
    const plannedExpiry = new Date(lastCreateCallAt.getTime() + 34 * 60 * 1000)
    await database.db.update(stripeCheckoutAttempt).set({
      stripeSessionId: null,
      checkoutUrl: null,
      expiresAt: null,
      status: 'creating',
      lastCreateCallAt,
      plannedExpiresAt: plannedExpiry,
    }).where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))

    const service = new StripeEventService(database.db, makeGateway({
      onCreate: async () => { throw new Error('ambiguous Stripe response') },
    }))
    await service.reconcileAttempts(10)

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [savedPayment] = await database.db.select().from(payment).where(eq(payment.orderId, fixture.orderId))
    const [attempt] = await database.db.select().from(stripeCheckoutAttempt)
      .where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))
    const [lot] = await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, fixture.lotId))
    expect(order?.status).toBe('pending_payment')
    expect(savedPayment?.status).toBe('awaiting_collection')
    expect(attempt?.status).toBe('manual_review')
    expect(lot).toMatchObject({ onHandQuantity: 4, reversibleQuantity: 1 })
    expect(await service.reconcileAttempts(10)).toBe(0)
  })

  it('does not replay an unbound create beyond idempotency retention even if its last call was retried recently', async () => {
    const fixture = await preparePendingOrder()
    const firstCreateCallAt = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const plannedExpiry = new Date(Math.ceil(firstCreateCallAt.getTime() / 1000) * 1000 + 34 * 60 * 1000)
    await database.db.update(stripeCheckoutAttempt).set({
      stripeSessionId: null,
      checkoutUrl: null,
      expiresAt: null,
      status: 'creating',
      lastCreateCallAt: new Date(),
      plannedExpiresAt: plannedExpiry,
    }).where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))

    let createCalls = 0
    const gateway = makeGateway({ onCreate: async () => {
      createCalls += 1
      return { sessionId: 'cs_test_too_old', url: 'https://checkout.stripe.com/c/pay/cs_test_too_old', expiresAt: plannedExpiry }
    } })
    const service = new StripeEventService(database.db, gateway)
    expect(await service.reconcileAttempts(10)).toBe(1)

    const [attempt] = await database.db.select().from(stripeCheckoutAttempt)
      .where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))
    const [order] = await database.db.select().from(commerceOrder)
      .where(eq(commerceOrder.id, fixture.orderId))
    expect(createCalls).toBe(0)
    expect(attempt?.status).toBe('manual_review')
    expect(order?.status).toBe('pending_payment')
  })

  it('does not overwrite a paid webhook when recovery fails concurrently', async () => {
    const fixture = await preparePendingOrder()
    const lastCreateCallAt = new Date(Date.now() - 37 * 60 * 1000)
    const plannedExpiry = new Date(lastCreateCallAt.getTime() + 34 * 60 * 1000)
    await database.db.update(stripeCheckoutAttempt).set({
      stripeSessionId: null,
      checkoutUrl: null,
      expiresAt: null,
      status: 'creating',
      lastCreateCallAt,
      plannedExpiresAt: plannedExpiry,
    }).where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))

    let signalStarted: (() => void) | undefined
    let failRecovery: ((error: Error) => void) | undefined
    const started = new Promise<void>((resolve) => { signalStarted = resolve })
    const recoveryResult = new Promise<never>((_resolve, reject) => { failRecovery = reject })
    const gateway = makeGateway({
      onCreate: async () => {
        signalStarted?.()
        return recoveryResult
      },
    })
    const service = new StripeEventService(database.db, gateway)
    const reconciliation = service.reconcileAttempts(1)
    await started
    await sendEvent(gateway, 'evt_paidrecovery', 'checkout.session.completed', sessionFor(fixture))
    failRecovery?.(new Error('ambiguous recovery response'))
    await reconciliation

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    const [savedPayment] = await database.db.select().from(payment).where(eq(payment.orderId, fixture.orderId))
    const [attempt] = await database.db.select().from(stripeCheckoutAttempt)
      .where(eq(stripeCheckoutAttempt.orderId, fixture.orderId))
    expect(order?.status).toBe('placed')
    expect(savedPayment?.status).toBe('collected')
    expect(attempt?.status).toBe('completed')
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
