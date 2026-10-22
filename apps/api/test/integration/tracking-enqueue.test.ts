import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  commerceOrder,
  commerceSettings,
  consentRecord,
  inventoryLot,
  orderAttribution,
  product,
  productVariant,
  trackingOutbox,
  user,
  warehouse,
} from '../../src/database/schema'
import { CartRepository } from '../../src/modules/cart/repository'
import { CartService } from '../../src/modules/cart/service'
import type { CartPrincipal } from '../../src/modules/cart/types'
import { QuoteService } from '../../src/modules/checkout/quote'
import { CheckoutService } from '../../src/modules/checkout/service'
import { StripeCheckoutService } from '../../src/modules/checkout/stripe-service'
import { StripeEventService } from '../../src/modules/payments/stripe/events'
import type { StripeGateway } from '../../src/modules/payments/stripe/gateway'
import { CommerceSettingsRepository } from '../../src/modules/commerce-settings/repository'
import { CommerceSettingsService } from '../../src/modules/commerce-settings/service'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { MediaUrls } from '../../src/modules/media/urls'
import { OrderService } from '../../src/modules/orders/service'
import { CONSENT_POLICY_VERSION } from '../../src/modules/tracking/policy'
import { normalizeEmail, sha256Hex } from '../../src/modules/tracking/identity'
import { loadPurchaseEvent } from '../../src/modules/tracking/purchase'
import type { PlacementTracking, TrackingContext } from '../../src/modules/tracking/context'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const commerceSecret = new Uint8Array(32).fill(61)
const customerId = 'tracking-customer'
const staffActor = {
  kind: 'staff' as const,
  userId: 'tracking-staff',
  auditContext: { requestId: 'tracking-test', ipAddress: '127.0.0.1', userAgent: 'test' },
}
let unlockDatabase: (() => Promise<void>) | undefined

const noConsent: PlacementTracking['consent'] = { consentRecordId: null, analytics: false, marketing: false }

function stripeGateway(): StripeGateway {
  return {
    checkoutReturnUrls: () => ({
      successUrl: 'https://shop.example.test/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://shop.example.test/checkout/cancel',
    }),
    createCheckout: async (input) => ({
      sessionId: `cs_test_${input.orderId}`,
      url: `https://checkout.stripe.com/c/pay/cs_test_${input.orderId}`,
      expiresAt: input.expiresAt,
    }),
    retrieveCheckout: async () => { throw new Error('not used') },
    createFullRefund: async () => { throw new Error('not used') },
    retrieveRefund: async () => { throw new Error('not used') },
    constructEvent: (rawBody) => JSON.parse(rawBody) as never,
  }
}

function guestPrincipal(): CartPrincipal {
  return { kind: 'guest', tokenHash: createHash('sha256').update(crypto.randomUUID()).digest('hex') }
}

async function insertConsent(marketing: boolean, analytics = true) {
  const [row] = await database.db.insert(consentRecord).values({
    visitorId: crypto.randomUUID(),
    analytics,
    marketing,
    policyVersion: CONSENT_POLICY_VERSION,
    requestId: crypto.randomUUID(),
  }).returning({ id: consentRecord.id })
  return row!.id
}

function tracking(context: TrackingContext | undefined, consent: PlacementTracking['consent'] = noConsent): PlacementTracking {
  return { context, consent, clientIp: '203.0.113.9', userAgent: 'UnitTest/1.0' }
}

async function prepare(principal: CartPrincipal) {
  const suffix = crypto.randomUUID()
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId, slug: `tracking-${suffix}`, name: 'Tracking Fruit Box',
    category: 'fresh', vatTreatment: 'exempt', status: 'published',
  })
  await database.db.insert(productVariant).values({
    id: variantId, productId, sku: `TRACKING-${suffix}`, name: 'Small box', unit: 'box',
    priceSatang: 1200, salesEnabled: true,
  })
  const [mainWarehouse] = await database.db.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.code, 'MAIN'))
  await database.db.insert(inventoryLot).values({
    id: crypto.randomUUID(), warehouseId: mainWarehouse!.id, variantId,
    lotCode: `TRACKING-${suffix.slice(0, 8)}`, expiryDate: '2999-12-31', onHandQuantity: 8,
  })

  const audit = new AuditService(new AuditRepository(database.db))
  const settings = new CommerceSettingsService(new CommerceSettingsRepository(database.db, audit))
  const cartService = new CartService(new CartRepository(database.db, new InventoryReadRepository(database.db), new MediaUrls(null)))
  const quote = new QuoteService(cartService, settings, commerceSecret)
  await cartService.setItem(principal, variantId, 2)
  const currentQuote = await quote.create(principal, new Date())
  return {
    quoteToken: currentQuote.quoteToken,
    input: {
      quoteToken: currentQuote.quoteToken,
      paymentMethod: 'cod' as const,
      contact: { email: ' Buyer@Example.test ' },
      billingAddress: {
        recipientName: 'Somchai Buyer', addressLine1: '12 Orchard Road', subdistrict: 'Talat Noi',
        district: 'Samphanthawong', province: 'Bangkok', postalCode: '10100', phone: '0812345678',
      },
    },
  }
}

async function placeCod(context: TrackingContext | undefined, consent = noConsent, key = `cod-${crypto.randomUUID()}`) {
  const principal: CartPrincipal = { kind: 'customer', userId: customerId }
  const prepared = await prepare(principal)
  const checkout = new CheckoutService(database.db, commerceSecret)
  const result = await checkout.placeCod(prepared.input, principal, key, tracking(context, consent))
  return { result, checkout, prepared, principal, key }
}

async function placeStripe(context?: TrackingContext, consent = noConsent) {
  const principal = guestPrincipal()
  const prepared = await prepare(principal)
  const gateway = stripeGateway()
  const service = new StripeCheckoutService(database.db, commerceSecret, gateway)
  const result = await service.place({ ...prepared.input, paymentMethod: 'stripe' }, principal, `stripe-${crypto.randomUUID()}`, tracking(context, consent))
  return { result, gateway }
}

async function settle(gateway: StripeGateway, orderId: string, eventId = `evt_paid${orderId.replaceAll('-', '')}`) {
  const order = await database.db.select({ total: commerceOrder.totalSatang }).from(commerceOrder).where(eq(commerceOrder.id, orderId))
  await new StripeEventService(database.db, gateway).handle(JSON.stringify({
    id: eventId,
    type: 'checkout.session.completed',
    data: { object: {
      id: `cs_test_${orderId}`,
      client_reference_id: orderId,
      metadata: { orderId },
      amount_total: order[0]!.total,
      currency: 'thb',
      payment_intent: `pi_test_${orderId.replaceAll('-', '')}`,
      status: 'complete',
      payment_status: 'paid',
    } },
  }), 'valid-signature')
}

async function outboxRows(orderId: string) {
  return database.db.select().from(trackingOutbox).where(eq(trackingOutbox.orderId, orderId))
}

const touch = (overrides: Record<string, string> = {}) => ({
  utmSource: 'facebook', utmMedium: 'cpc', utmCampaign: 'spring', utmContent: 'ad-1', utmTerm: 'durian',
  gclid: 'gclid-123', landingPath: '/products/durian', referrer: 'https://l.facebook.com/',
  capturedAt: new Date().toISOString(),
  ...overrides,
})

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

beforeEach(async () => {
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  for (const [id, accountType, role] of [[customerId, 'customer', 'customer'], ['tracking-staff', 'staff', 'admin']] as const) {
    await database.db.insert(user).values({
      id, name: id, email: `${id}@example.test`, emailVerified: true, createdAt: now, updatedAt: now, role, accountType,
    })
  }
  await database.db.update(commerceSettings).set({ shippingFeeSatang: 725, checkoutEnabled: true, version: 2 })
    .where(eq(commerceSettings.id, 1))
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

describe('order attribution and purchase tracking enqueue', () => {
  it('stores attribution and enqueues every destination for a marketing-consented COD order', async () => {
    const consentId = await insertConsent(true)
    const context: TrackingContext = {
      consentId,
      posthogDistinctId: 'ph-visitor-1',
      firstTouch: touch({ utmSource: 'google' }),
      lastTouch: touch(),
      fbp: 'fb.1.123.456', fbc: 'fb.1.123.abc', ttp: 'tt-cookie',
    }
    const { result } = await placeCod(context, { consentRecordId: consentId, analytics: true, marketing: true })

    const [attribution] = await database.db.select().from(orderAttribution).where(eq(orderAttribution.orderId, result.order.id))
    expect(attribution).toMatchObject({
      consentRecordId: consentId,
      analyticsConsent: true,
      marketingConsent: true,
      posthogDistinctId: 'ph-visitor-1',
      utmSource: 'facebook', utmMedium: 'cpc', utmCampaign: 'spring', utmContent: 'ad-1', utmTerm: 'durian',
      gclid: 'gclid-123', landingPath: '/products/durian', referrer: 'https://l.facebook.com/',
      fbp: 'fb.1.123.456', fbc: 'fb.1.123.abc', ttp: 'tt-cookie',
      clientIp: '203.0.113.9', userAgent: 'UnitTest/1.0',
    })
    expect(attribution!.lastTouchAt).toBeInstanceOf(Date)
    expect(attribution!.firstTouch).toMatchObject({ utmSource: 'google' })

    const rows = await outboxRows(result.order.id)
    expect(rows.map((row) => row.destination).sort()).toEqual(['google_ads', 'meta', 'posthog', 'tiktok'])
    expect(rows.every((row) => row.status === 'pending' && row.expiresAt instanceof Date)).toBe(true)
  })

  it('records no consent and only the posthog row when no consentId is given', async () => {
    const { result } = await placeCod({ lastTouch: touch() })

    const [attribution] = await database.db.select().from(orderAttribution).where(eq(orderAttribution.orderId, result.order.id))
    expect(attribution).toMatchObject({ consentRecordId: null, analyticsConsent: false, marketingConsent: false, utmCampaign: 'spring' })
    const rows = await outboxRows(result.order.id)
    expect(rows.map((row) => row.destination)).toEqual(['posthog'])
  })

  it('writes an attribution row even when the client sent no tracking', async () => {
    const { result } = await placeCod(undefined)

    const [attribution] = await database.db.select().from(orderAttribution).where(eq(orderAttribution.orderId, result.order.id))
    expect(attribution).toMatchObject({ analyticsConsent: false, marketingConsent: false, utmSource: null, lastTouchAt: null })
    expect(await outboxRows(result.order.id)).toHaveLength(1)
  })

  it('enqueues Stripe orders only when payment settles, and not again on a replayed webhook', async () => {
    const consentId = await insertConsent(true)
    const { result, gateway } = await placeStripe(
      { consentId, lastTouch: touch() },
      { consentRecordId: consentId, analytics: true, marketing: true },
    )
    const orderId = result.order.id

    const [attribution] = await database.db.select().from(orderAttribution).where(eq(orderAttribution.orderId, orderId))
    expect(attribution).toMatchObject({ marketingConsent: true, utmCampaign: 'spring' })
    expect(await outboxRows(orderId)).toHaveLength(0)

    await settle(gateway, orderId)
    const settled = await outboxRows(orderId)
    expect(settled.map((row) => row.destination).sort()).toEqual(['google_ads', 'meta', 'posthog', 'tiktok'])

    await settle(gateway, orderId, `evt_replay${orderId.replaceAll('-', '')}`)
    expect(await outboxRows(orderId)).toHaveLength(4)
  })

  it('keeps the first attribution and order when an idempotent retry sends different tracking', async () => {
    const first = await placeCod({ lastTouch: touch({ utmCampaign: 'first-campaign' }) })
    const retry = await first.checkout.placeCod(
      first.prepared.input,
      first.principal,
      first.key,
      tracking({ lastTouch: touch({ utmCampaign: 'second-campaign' }) }),
    )

    expect(retry.order.id).toBe(first.result.order.id)
    const [attribution] = await database.db.select().from(orderAttribution).where(eq(orderAttribution.orderId, first.result.order.id))
    expect(attribution!.utmCampaign).toBe('first-campaign')
    expect(await outboxRows(first.result.order.id)).toHaveLength(1)
  })

  it('does not enqueue tracking when guest access is reissued', async () => {
    const { result, gateway } = await placeStripe()
    await settle(gateway, result.order.id)
    const before = await outboxRows(result.order.id)

    const service = new OrderService(database.db, commerceSecret) as unknown as {
      reissueGuestAccess(orderId: string, reason: string, actor: typeof staffActor, key: string): Promise<unknown>
    }
    await service.reissueGuestAccess(result.order.id, 'support_recovery', staffActor, 'reissue-tracking-1')

    expect(await outboxRows(result.order.id)).toHaveLength(before.length)
    expect(before).toHaveLength(1)
  })

  it('builds the purchase event with hashed contact only for marketing consent', async () => {
    const consentId = await insertConsent(true)
    const marketing = await placeCod(
      { consentId, lastTouch: touch(), fbp: 'fb.1.123.456' },
      { consentRecordId: consentId, analytics: true, marketing: true },
    )
    const plain = await placeCod({ lastTouch: touch() })

    const [order] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, marketing.result.order.id))
    const event = await loadPurchaseEvent(database.db, marketing.result.order.id)
    expect(event).not.toBeNull()
    expect(event!.value).toBe(order!.subtotalSatang / 100)
    expect(event!.shipping).toBe(order!.shippingSatang / 100)
    expect(event!.user.emailSha256).toBe(sha256Hex(normalizeEmail(order!.contactEmail)!))
    expect(event!.user.fbp).toBe('fb.1.123.456')
    expect(event!.user.gclid).toBe('gclid-123')

    const plainEvent = await loadPurchaseEvent(database.db, plain.result.order.id)
    expect(plainEvent!.marketingConsent).toBe(false)
    expect(Object.values(plainEvent!.user).every((value) => value === null)).toBe(true)
  })
})
