import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import {
  commerceSettings,
  inventoryLot,
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
import { CommerceSettingsRepository } from '../../src/modules/commerce-settings/repository'
import { CommerceSettingsService } from '../../src/modules/commerce-settings/service'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { MediaUrls } from '../../src/modules/media/urls'
import { TrackingOutbox } from '../../src/modules/tracking/outbox'
import { TrackingDeliveryError, type PurchaseEvent, type TrackingAdapter, type TrackingDestination } from '../../src/modules/tracking/types'
import type { PlacementTracking, TrackingContext } from '../../src/modules/tracking/context'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const commerceSecret = new Uint8Array(32).fill(61)
const customerId = 'tracking-customer'
let unlockDatabase: (() => Promise<void>) | undefined

const noConsent: PlacementTracking['consent'] = { consentRecordId: null, analytics: false, marketing: false }

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


async function placeCod(context: TrackingContext | undefined) {
  const principal: CartPrincipal = { kind: 'customer', userId: customerId }
  const prepared = await prepare(principal)
  const checkout = new CheckoutService(database.db, commerceSecret)
  const result = await checkout.placeCod(prepared.input, principal, `cod-${crypto.randomUUID()}`, tracking(context))
  return { result }
}

function adapter(destination: TrackingDestination, send: (event: PurchaseEvent) => Promise<void>) {
  const calls: PurchaseEvent[] = []
  const value: TrackingAdapter = {
    destination,
    maxEventAgeMs: 1000,
    send: async (event) => { calls.push(event); await send(event) },
  }
  return { value, calls }
}

async function orderWithRow(destination: TrackingDestination, overrides: Partial<typeof trackingOutbox.$inferInsert> = {}) {
  const { result } = await placeCod(undefined)
  await database.db.delete(trackingOutbox).where(eq(trackingOutbox.orderId, result.order.id))
  const [row] = await database.db.insert(trackingOutbox).values({
    orderId: result.order.id,
    destination,
    eventName: 'purchase',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  }).returning()
  return row!
}

async function reload(id: string) {
  const [row] = await database.db.select().from(trackingOutbox).where(eq(trackingOutbox.id, id))
  return row!
}

describe('TrackingOutbox', () => {
  it('marks a delivered row sent', async () => {
    const row = await orderWithRow('posthog')
    const fake = adapter('posthog', async () => {})
    const outbox = new TrackingOutbox(database.db, { posthog: fake.value })

    expect(await outbox.processBatch(10)).toBe(1)

    const saved = await reload(row.id)
    expect(saved.status).toBe('sent')
    expect(saved.sentAt).not.toBeNull()
    expect(saved.attemptCount).toBe(1)
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]!.eventId).toBe(row.orderId)
  })

  it('expires a row after a non-retryable error on the next claim without calling the adapter again', async () => {
    const row = await orderWithRow('meta')
    const fake = adapter('meta', async () => { throw new TrackingDeliveryError('META_AUTH', false) })
    const outbox = new TrackingOutbox(database.db, { meta: fake.value })

    await outbox.processBatch(10)
    const failed = await reload(row.id)
    expect(failed.status).toBe('failed')
    expect(failed.lastErrorCode).toBe('META_AUTH')
    expect(failed.nextAttemptAt.getTime()).toBe(row.expiresAt.getTime())

    // Move the clock past expiresAt so the row becomes due.
    const later = new TrackingOutbox(database.db, { meta: fake.value }, () => new Date(row.expiresAt.getTime() + 1000))
    await database.db.update(trackingOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(trackingOutbox.id, row.id))
    await later.processBatch(10)

    const saved = await reload(row.id)
    expect(saved.status).toBe('expired')
    expect(saved.lastErrorCode).toBe('EVENT_TOO_OLD')
    expect(fake.calls).toHaveLength(1)
  })

  it('backs off a retryable error by 30 seconds', async () => {
    const row = await orderWithRow('posthog')
    const fake = adapter('posthog', async () => { throw new TrackingDeliveryError('POSTHOG_5XX', true) })
    const now = new Date()
    const outbox = new TrackingOutbox(database.db, { posthog: fake.value }, () => now)

    await outbox.processBatch(10)

    const saved = await reload(row.id)
    expect(saved.status).toBe('failed')
    expect(saved.attemptCount).toBe(1)
    expect(saved.lastErrorCode).toBe('POSTHOG_5XX')
    expect(saved.lastFailedAt?.getTime()).toBe(now.getTime())
    expect(saved.nextAttemptAt.getTime()).toBe(now.getTime() + 30 * 1000)
  })

  it('records DELIVERY_FAILED for an unknown throw', async () => {
    const row = await orderWithRow('posthog')
    const fake = adapter('posthog', async () => { throw new Error('boom') })
    await new TrackingOutbox(database.db, { posthog: fake.value }).processBatch(10)

    const saved = await reload(row.id)
    expect(saved.status).toBe('failed')
    expect(saved.lastErrorCode).toBe('DELIVERY_FAILED')
  })

  it('skips a row whose destination has no adapter', async () => {
    const row = await orderWithRow('tiktok')
    await new TrackingOutbox(database.db, {}).processBatch(10)

    const saved = await reload(row.id)
    expect(saved.status).toBe('skipped')
    expect(saved.claimedAt).toBeNull()
  })

  it('expires a row past expiresAt without calling the adapter', async () => {
    const row = await orderWithRow('meta', { expiresAt: new Date(Date.now() - 60 * 1000) })
    const fake = adapter('meta', async () => {})
    await new TrackingOutbox(database.db, { meta: fake.value }).processBatch(10)

    const saved = await reload(row.id)
    expect(saved.status).toBe('expired')
    expect(saved.lastErrorCode).toBe('EVENT_TOO_OLD')
    expect(fake.calls).toHaveLength(0)
  })

  it('treats a missing purchase event as a non-retryable failure', async () => {
    const row = await orderWithRow('posthog')
    // order_event is append-only, so lift its guard triggers for this one delete.
    await database.db.execute(sql`alter table order_event disable trigger user`)
    await database.db.execute(sql`delete from order_outbox where order_id = ${row.orderId}`)
    await database.db.execute(sql`delete from order_event where order_id = ${row.orderId}`)
    await database.db.execute(sql`alter table order_event enable trigger user`)
    const fake = adapter('posthog', async () => {})
    await new TrackingOutbox(database.db, { posthog: fake.value }).processBatch(10)

    const saved = await reload(row.id)
    expect(saved.status).toBe('failed')
    expect(saved.lastErrorCode).toBe('EVENT_UNAVAILABLE')
    expect(fake.calls).toHaveLength(0)
  })
})
