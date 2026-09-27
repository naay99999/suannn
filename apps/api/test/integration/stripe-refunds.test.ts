import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  commerceOrder,
  commerceSettings,
  inventoryLot,
  orderEvent,
  payment,
  product,
  productVariant,
  stripeRefund,
  user,
  warehouse,
} from '../../src/database/schema'
import { CartRepository } from '../../src/modules/cart/repository'
import { CartService } from '../../src/modules/cart/service'
import type { CartPrincipal } from '../../src/modules/cart/types'
import { QuoteService } from '../../src/modules/checkout/quote'
import { StripeCheckoutService } from '../../src/modules/checkout/stripe-service'
import { CheckoutService } from '../../src/modules/checkout/service'
import type { CheckoutSessionState, StripeGateway, StripeRefundState } from '../../src/modules/payments/stripe/gateway'
import { StripeEventService } from '../../src/modules/payments/stripe/events'
import { StripeRefundService } from '../../src/modules/payments/stripe/refunds'
import { OrderService } from '../../src/modules/orders/service'
import type { OrderStaffActor } from '../../src/modules/orders/types'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'
import { CommerceSettingsRepository } from '../../src/modules/commerce-settings/repository'
import { CommerceSettingsService } from '../../src/modules/commerce-settings/service'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'

const database = createTestDatabase()
const secret = new Uint8Array(32).fill(19)
const actorId = 'stripe-refund-owner'
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
    name: 'Stripe Refund Owner',
    email: 'stripe-refund-owner@example.test',
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
  refund?: StripeRefundState
  onCreateRefund?: (input: Parameters<StripeGateway['createFullRefund']>[0]) => Promise<StripeRefundState>
  onRetrieveRefund?: (refundId: string) => Promise<StripeRefundState>
} = {}): StripeGateway {
  return {
    createCheckout: async ({ orderId }) => ({
      sessionId: `cs_test_${orderId.replaceAll('-', '')}`,
      url: `https://checkout.stripe.com/c/pay/cs_test_${orderId.replaceAll('-', '')}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }),
    retrieveCheckout: async (sessionId): Promise<CheckoutSessionState> => ({
      sessionId,
      orderId: null,
      amountSatang: null,
      currency: null,
      status: null,
      paymentStatus: null,
      paymentIntentId: null,
      expiresAt: null,
    }),
    createFullRefund: async (input) => options.onCreateRefund
      ? options.onCreateRefund(input)
      : options.refund ?? {
        refundId: 're_testrefund',
        orderId: input.orderId,
        refundClaimId: input.refundClaimId,
        paymentIntentId: input.paymentIntentId,
        amountSatang: 1925,
        currency: 'thb',
        status: 'pending',
      },
    retrieveRefund: async (refundId) => options.onRetrieveRefund
      ? options.onRetrieveRefund(refundId)
      : options.refund ?? {
        refundId,
        orderId: null,
        refundClaimId: null,
        paymentIntentId: 'pi_test_refund',
        amountSatang: 1925,
        currency: 'thb',
        status: 'pending',
      },
    constructEvent(rawBody, signature) {
      if (signature !== 'valid-signature') throw new Error('Invalid signature')
      return JSON.parse(rawBody) as StripeGatewayEvent
    },
  }
}

type StripeGatewayEvent = ReturnType<StripeGateway['constructEvent']>

function stripeEvent(eventId: string, type: string, object: Record<string, unknown>) {
  return {
    id: eventId,
    object: 'event',
    api_version: '2026-08-26.dahlia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
    data: { object },
  } as unknown as StripeGatewayEvent
}

async function prepareCancelledOrder(paymentMethod: 'stripe' | 'cod' = 'stripe') {
  const suffix = crypto.randomUUID()
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  const lotId = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId,
    slug: `stripe-refund-${suffix}`,
    name: 'Refund Fruit Box',
    category: 'fresh',
    status: 'published',
  })
  await database.db.insert(productVariant).values({
    id: variantId,
    productId,
    sku: `REFUND-${suffix}`,
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
    lotCode: `REFUND-${suffix.slice(0, 8)}`,
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
  const cart = new CartService(new CartRepository(database.db, new InventoryReadRepository(database.db)))
  const quote = new QuoteService(cart, settings, secret)
  await cart.setItem(principal, variantId, 1)
  const quoteResult = await quote.create(principal, new Date())
  const input = {
    quoteToken: quoteResult.quoteToken,
    contact: { email: 'buyer@example.test', phone: '081-234-5678' },
    address,
  }
  const placed = paymentMethod === 'stripe'
    ? await new StripeCheckoutService(database.db, secret, makeGateway()).place({ ...input, paymentMethod }, principal, `stripe-refund-${suffix}`)
    : await new CheckoutService(database.db, secret).placeCod({ ...input, paymentMethod }, principal, `cod-refund-${suffix}`)
  const paymentIntentId = `pi_test_${suffix.replaceAll('-', '')}`
  if (paymentMethod === 'stripe') {
    const events = new StripeEventService(database.db, makeGateway())
    await events.handle(JSON.stringify(stripeEvent(`evt_paid${suffix.replaceAll('-', '')}`, 'checkout.session.completed', {
      id: `cs_test_${placed.order.id.replaceAll('-', '')}`,
      client_reference_id: placed.order.id,
      metadata: { orderId: placed.order.id },
      amount_total: 1925,
      currency: 'thb',
      payment_status: 'paid',
      status: 'complete',
      payment_intent: paymentIntentId,
    })), 'valid-signature')
  }

  const actor: OrderStaffActor = {
    kind: 'staff',
    userId: actorId,
    auditContext: { requestId: `refund-request-${suffix}`, ipAddress: '127.0.0.1', userAgent: 'refund-test' },
  }
  const orders = new OrderService(database.db, secret)
  const cancelled = await orders.cancel(placed.order.id, actor, `cancel-${suffix}`)
  return { orderId: placed.order.id, paymentIntentId, actor, cancelled }
}

const preparePaidCancelledStripeOrder = () => prepareCancelledOrder('stripe')

function createRefundService(gateway: StripeGateway) {
  return new StripeRefundService(database.db, gateway)
}

describe('Stripe admin refund lifecycle', () => {
  it('cancels a collected Stripe order without requesting a refund', async () => {
    const fixture = await preparePaidCancelledStripeOrder()
    expect(fixture.cancelled.status).toBe('cancelled')
    expect(fixture.cancelled.payment.status).toBe('collected')
    expect(fixture.cancelled.payment.refund).toBeUndefined()
    expect(await database.db.select().from(stripeRefund)).toHaveLength(0)
  })

  it('requests exactly the paid order amount from the stored PaymentIntent', async () => {
    const fixture = await preparePaidCancelledStripeOrder()
    const refundCalls: Array<Parameters<StripeGateway['createFullRefund']>[0]> = []
    const service = createRefundService(makeGateway({
      onCreateRefund: async (input) => {
        refundCalls.push(input)
        return {
          refundId: 're_testfullamount',
          orderId: input.orderId,
          refundClaimId: input.refundClaimId,
          paymentIntentId: input.paymentIntentId,
          amountSatang: 1925,
          currency: 'thb',
          status: 'pending',
        }
      },
    }))

    const result = await service.requestFullRefund(fixture.orderId, fixture.actor, 'full-refund-1')

    expect(refundCalls).toEqual([{
      orderId: fixture.orderId,
      refundClaimId: expect.any(String),
      paymentIntentId: fixture.paymentIntentId,
      idempotencyKey: expect.any(String),
    }])
    expect(result.payment).toMatchObject({ status: 'collected', amountSatang: 1925 })
    expect(result.payment.refund).toMatchObject({ amountSatang: 1925, status: 'pending' })
    expect(refundCalls[0]).not.toHaveProperty('amountSatang')
    expect((await database.db.select().from(stripeRefund))[0]?.amountSatang).toBe(1925)
  })

  it('replays the same refund for the same key and blocks concurrent different keys', async () => {
    const fixture = await preparePaidCancelledStripeOrder()
    let callCount = 0
    let releaseRefund: ((state: StripeRefundState) => void) | undefined
    const stripeRefundPending = new Promise<StripeRefundState>((resolve) => { releaseRefund = resolve })
    const service = createRefundService(makeGateway({
      onCreateRefund: async (input) => {
        callCount += 1
        return stripeRefundPending.then((state) => ({
          ...state,
          orderId: input.orderId,
          refundClaimId: input.refundClaimId,
          paymentIntentId: input.paymentIntentId,
        }))
      },
    }))

    const firstRequest = service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-key-first')
    await new Promise((resolve) => setTimeout(resolve, 30))
    await expect(service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-key-second'))
      .rejects.toMatchObject({ code: 'ORDER_REFUND_CONFLICT' })
    releaseRefund?.({
      refundId: 're_testconcurrent',
      orderId: fixture.orderId,
      refundClaimId: null,
      paymentIntentId: fixture.paymentIntentId,
      amountSatang: 1925,
      currency: 'thb',
      status: 'pending',
    })
    const firstResult = await firstRequest
    const replay = await service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-key-first')

    expect(callCount).toBe(1)
    expect(firstResult.payment.refund?.id).toBe(replay.payment.refund?.id)
    expect(await database.db.select().from(stripeRefund)).toHaveLength(1)
  })

  it('keeps requires_action visible and only updates the matching claim from refund webhooks', async () => {
    const fixture = await preparePaidCancelledStripeOrder()
    const service = createRefundService(makeGateway({
      onCreateRefund: async (input) => ({
        refundId: 're_testrequiresaction',
        orderId: input.orderId,
        refundClaimId: input.refundClaimId,
        paymentIntentId: input.paymentIntentId,
        amountSatang: 1925,
        currency: 'thb',
        status: 'requires_action',
      }),
    }))
    const requested = await service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-action')
    expect(requested.payment.refund?.status).toBe('requires_action')

    const gateway = makeGateway()
    const events = new StripeEventService(database.db, gateway)
    const matchedRefund = {
      id: 're_testrequiresaction',
      object: 'refund',
      metadata: { orderId: fixture.orderId },
      payment_intent: fixture.paymentIntentId,
      amount: 1925,
      currency: 'thb',
      status: 'succeeded',
    }
    await events.handle(JSON.stringify(stripeEvent('evt_refundunmatched', 'refund.updated', {
      ...matchedRefund,
      id: 're_unknownrefund',
    })), 'valid-signature')
    expect((await database.db.select().from(stripeRefund))[0]?.status).toBe('requires_action')

    await events.handle(JSON.stringify(stripeEvent('evt_refundsuccess', 'refund.updated', matchedRefund)), 'valid-signature')
    await events.handle(JSON.stringify(stripeEvent('evt_refundstale', 'refund.created', {
      ...matchedRefund,
      status: 'pending',
    })), 'valid-signature')
    const [refund] = await database.db.select().from(stripeRefund)
    const [savedPayment] = await database.db.select().from(payment).where(eq(payment.orderId, fixture.orderId))
    expect(refund?.status).toBe('succeeded')
    expect(savedPayment?.status).toBe('collected')
  })

  it('reconciles unresolved refunds and checks a failed Stripe state before retrying', async () => {
    const fixture = await preparePaidCancelledStripeOrder()
    let retrieveCount = 0
    let createCount = 0
    let providerStatus: StripeRefundState['status'] = 'failed'
    const gateway = makeGateway({
      onCreateRefund: async (input) => {
        createCount += 1
        return {
          refundId: createCount === 1 ? 're_testfailed' : 're_testretry',
          orderId: input.orderId,
          refundClaimId: input.refundClaimId,
          paymentIntentId: input.paymentIntentId,
          amountSatang: 1925,
          currency: 'thb',
          status: createCount === 1 ? 'pending' : 'pending',
        }
      },
      onRetrieveRefund: async (refundId) => {
        retrieveCount += 1
        return {
          refundId,
          orderId: fixture.orderId,
          refundClaimId: null,
          paymentIntentId: fixture.paymentIntentId,
          amountSatang: 1925,
          currency: 'thb',
          status: providerStatus,
        }
      },
    })
    const service = createRefundService(gateway)
    await service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-failed')
    const events = new StripeEventService(database.db, gateway)
    await events.handle(JSON.stringify(stripeEvent('evt_refundfailed', 'refund.failed', {
      id: 're_testfailed',
      object: 'refund',
      metadata: { orderId: fixture.orderId },
      payment_intent: fixture.paymentIntentId,
      amount: 1925,
      currency: 'thb',
      status: 'failed',
    })), 'valid-signature')

    const retry = await service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-retry')
    expect(retrieveCount).toBeGreaterThan(0)
    expect(createCount).toBe(2)
    expect(retry.payment.refund?.status).toBe('pending')

    providerStatus = 'succeeded'
    expect(await service.reconcileRefunds(10)).toBe(1)
    const claims = await database.db.select().from(stripeRefund).orderBy(stripeRefund.createdAt)
    expect(claims.map(({ status }) => status)).toEqual(['failed', 'succeeded'])
    await expect(service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-after-success'))
      .rejects.toMatchObject({ code: 'ORDER_REFUND_CONFLICT' })
  })

  it('does not let ID-less ambiguous claims starve a bounded reconciliation batch', async () => {
    const ambiguous = await preparePaidCancelledStripeOrder()
    const known = await preparePaidCancelledStripeOrder()
    let createCount = 0
    const retrieved: string[] = []
    const gateway = makeGateway({
      onCreateRefund: async (input) => {
        createCount += 1
        if (createCount === 1) throw new Error('ambiguous create response')
        return {
          refundId: 're_batchknown',
          orderId: input.orderId,
          refundClaimId: input.refundClaimId,
          paymentIntentId: input.paymentIntentId,
          amountSatang: 1925,
          currency: 'thb',
          status: 'pending',
        }
      },
      onRetrieveRefund: async (refundId) => {
        retrieved.push(refundId)
        return {
          refundId,
          orderId: known.orderId,
          refundClaimId: null,
          paymentIntentId: known.paymentIntentId,
          amountSatang: 1925,
          currency: 'thb',
          status: 'succeeded',
        }
      },
    })
    const service = createRefundService(gateway)
    await expect(service.requestFullRefund(ambiguous.orderId, ambiguous.actor, 'refund-ambiguous-batch'))
      .rejects.toMatchObject({ code: 'STRIPE_REFUND_UNAVAILABLE' })
    await service.requestFullRefund(known.orderId, known.actor, 'refund-known-batch')
    const [unknownClaim] = await database.db.select().from(stripeRefund)
      .where(eq(stripeRefund.idempotencyKey, 'refund-ambiguous-batch'))
    if (!unknownClaim) throw new Error('Expected unresolved claim after ambiguous create response')
    await database.db.update(stripeRefund).set({ updatedAt: new Date('2000-01-01T00:00:00.000Z') })
      .where(eq(stripeRefund.id, unknownClaim.id))

    expect(await service.reconcileRefunds(1)).toBe(1)
    expect(retrieved).toEqual(['re_batchknown'])
  })

  it('does not regress webhook success when reconciliation returns a stale pending read', async () => {
    const fixture = await preparePaidCancelledStripeOrder()
    let signalRetrieved: (() => void) | undefined
    let returnStaleRead: ((state: StripeRefundState) => void) | undefined
    const retrieveStarted = new Promise<void>((resolve) => { signalRetrieved = resolve })
    const staleRead = new Promise<StripeRefundState>((resolve) => { returnStaleRead = resolve })
    const gateway = makeGateway({
      onCreateRefund: async (input) => ({
        refundId: 're_reconcileorder',
        orderId: input.orderId,
        refundClaimId: input.refundClaimId,
        paymentIntentId: input.paymentIntentId,
        amountSatang: 1925,
        currency: 'thb',
        status: 'pending',
      }),
      onRetrieveRefund: async () => {
        signalRetrieved?.()
        return staleRead
      },
    })
    const service = createRefundService(gateway)
    await service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-reconcile-order')
    const reconciliation = service.reconcileRefunds(1)
    await retrieveStarted

    const events = new StripeEventService(database.db, makeGateway())
    await events.handle(JSON.stringify(stripeEvent('evt_reconcilewins', 'refund.updated', {
      id: 're_reconcileorder',
      object: 'refund',
      metadata: { orderId: fixture.orderId },
      payment_intent: fixture.paymentIntentId,
      amount: 1925,
      currency: 'thb',
      status: 'succeeded',
    })), 'valid-signature')
    returnStaleRead?.({
      refundId: 're_reconcileorder',
      orderId: fixture.orderId,
      refundClaimId: null,
      paymentIntentId: fixture.paymentIntentId,
      amountSatang: 1925,
      currency: 'thb',
      status: 'pending',
    })
    await reconciliation

    const [claim] = await database.db.select().from(stripeRefund)
      .where(eq(stripeRefund.idempotencyKey, 'refund-reconcile-order'))
    expect(claim?.status).toBe('succeeded')
  })

  it('uses the same order-first lock order for concurrent requests and refund webhooks', async () => {
    const fixture = await preparePaidCancelledStripeOrder()
    const gateway = makeGateway({
      onCreateRefund: async (input) => ({
        refundId: 're_lockorder',
        orderId: input.orderId,
        refundClaimId: input.refundClaimId,
        paymentIntentId: input.paymentIntentId,
        amountSatang: 1925,
        currency: 'thb',
        status: 'pending',
      }),
    })
    const service = createRefundService(gateway)
    await service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-lock-order')
    const events = new StripeEventService(database.db, makeGateway())
    const concurrentOperations = Array.from({ length: 12 }, (_, index) => [
      service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-lock-order'),
      events.handle(JSON.stringify(stripeEvent(`evt_lockorder${index}`, 'refund.updated', {
        id: 're_lockorder',
        object: 'refund',
        metadata: { orderId: fixture.orderId },
        payment_intent: fixture.paymentIntentId,
        amount: 1925,
        currency: 'thb',
        status: 'pending',
      })), 'valid-signature'),
    ]).flat()

    const results = await Promise.allSettled(concurrentOperations)
    expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    const [claim] = await database.db.select().from(stripeRefund)
      .where(eq(stripeRefund.idempotencyKey, 'refund-lock-order'))
    expect(claim?.status).toBe('pending')
  })

  it('binds an early refund-created event without changing payment collection', async () => {
    const fixture = await preparePaidCancelledStripeOrder()
    const service = createRefundService(makeGateway({ onCreateRefund: async () => { throw new Error('ambiguous response') } }))
    await expect(service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-created-event'))
      .rejects.toMatchObject({ code: 'STRIPE_REFUND_UNAVAILABLE' })
    const [claim] = await database.db.select().from(stripeRefund)
      .where(eq(stripeRefund.idempotencyKey, 'refund-created-event'))
    if (!claim) throw new Error('Expected persisted refund claim')
    const events = new StripeEventService(database.db, makeGateway())

    await events.handle(JSON.stringify(stripeEvent('evt_refundcreated', 'refund.created', {
      id: 're_testcreatedevent',
      object: 'refund',
      metadata: { orderId: fixture.orderId, refundClaimId: claim.id },
      payment_intent: fixture.paymentIntentId,
      amount: 1925,
      currency: 'thb',
      status: 'pending',
    })), 'valid-signature')

    const [updatedClaim] = await database.db.select().from(stripeRefund).where(eq(stripeRefund.id, claim.id))
    const [savedPayment] = await database.db.select().from(payment).where(eq(payment.orderId, fixture.orderId))
    expect(updatedClaim).toMatchObject({ stripeRefundId: 're_testcreatedevent', status: 'pending' })
    expect(savedPayment?.status).toBe('collected')
  })

  it('rejects orders that are not cancelled paid Stripe orders', async () => {
    const fixture = await preparePaidCancelledStripeOrder()
    await expect(createRefundService(makeGateway()).requestFullRefund(
      crypto.randomUUID(), fixture.actor, 'refund-missing',
    )).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })

    const service = createRefundService(makeGateway())
    for (const status of ['placed', 'processing', 'packed', 'shipped', 'pending_payment'] as const) {
      await database.db.update(commerceOrder).set({ status }).where(eq(commerceOrder.id, fixture.orderId))
      await expect(service.requestFullRefund(fixture.orderId, fixture.actor, `refund-${status}`))
        .rejects.toMatchObject({ code: 'INVALID_ORDER_TRANSITION' })
    }
    await database.db.update(commerceOrder).set({ status: 'cancelled' }).where(eq(commerceOrder.id, fixture.orderId))
    await expect(service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-valid'))
      .resolves.toMatchObject({ payment: { refund: { status: 'pending' } } })
    await expect(service.requestFullRefund(fixture.orderId, fixture.actor, 'refund-second'))
      .rejects.toMatchObject({ code: 'ORDER_REFUND_CONFLICT' })

    const cod = await prepareCancelledOrder('cod')
    await expect(createRefundService(makeGateway()).requestFullRefund(cod.orderId, cod.actor, 'refund-cod'))
      .rejects.toMatchObject({ code: 'ORDER_PAYMENT_CONFLICT' })

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, fixture.orderId))
    expect(order?.status).toBe('cancelled')
    expect((await database.db.select().from(orderEvent).where(eq(orderEvent.orderId, fixture.orderId)))
      .some(({ eventType }) => eventType === 'order.cancelled')).toBe(true)
  })
})
