import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import {
  auditLog,
  commerceSettings,
  inventoryLot,
  orderEvent,
  orderOutbox,
  product,
  productVariant,
  receipt,
  receiptCounter,
  receiptSettings,
  user,
  warehouse,
} from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { CartRepository } from '../../src/modules/cart/repository'
import { CartService } from '../../src/modules/cart/service'
import type { CartPrincipal } from '../../src/modules/cart/types'
import { QuoteService } from '../../src/modules/checkout/quote'
import { CheckoutService } from '../../src/modules/checkout/service'
import { StripeCheckoutService } from '../../src/modules/checkout/stripe-service'
import { CommerceSettingsRepository } from '../../src/modules/commerce-settings/repository'
import { CommerceSettingsService } from '../../src/modules/commerce-settings/service'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { createAdminOrdersModule, createStoreOrdersModule } from '../../src/modules/orders'
import { OrderService } from '../../src/modules/orders/service'
import type { StripeGateway } from '../../src/modules/payments/stripe/gateway'
import { StripeEventService } from '../../src/modules/payments/stripe/events'
import { issueReceiptInTransaction } from '../../src/modules/receipts/issue'
import { receiptPeriod } from '../../src/modules/receipts/number'
import { ReceiptSettingsRepository, ReceiptSettingsService } from '../../src/modules/receipts/settings'
import type { ReceiptSnapshot } from '../../src/modules/receipts/types'
import type { Auth } from '../../src/plugins/auth/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'
import { testEnv } from '../fixtures'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const config = loadConfig(testEnv)
const commerceSecret = new Uint8Array(32).fill(41)
const customerId = 'receipts-customer'
const staffId = 'receipts-staff'
const auditContext = { requestId: 'receipts-test', ipAddress: '127.0.0.1', userAgent: 'test' }
const staffActor = { kind: 'staff' as const, userId: staffId, auditContext }
let unlockDatabase: (() => Promise<void>) | undefined

const seller = {
  sellerName: 'บริษัท สวนนานา จำกัด',
  sellerTaxId: '0105536092641',
  sellerBranch: '00000',
  sellerAddressLine1: '99 ถนนสุขุมวิท',
  sellerSubdistrict: 'คลองตัน',
  sellerDistrict: 'คลองเตย',
  sellerProvince: 'กรุงเทพมหานคร',
  sellerPostalCode: '10110',
}

const billingAddress = {
  recipientName: 'Somchai Buyer',
  addressLine1: '12 Orchard Road',
  subdistrict: 'Talat Noi',
  district: 'Samphanthawong',
  province: 'Bangkok',
  postalCode: '10100',
  phone: '0812345678',
}

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
})

beforeEach(async () => {
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values([
    { id: customerId, name: 'Receipt Customer', email: 'receipt-customer@example.test', emailVerified: true, createdAt: now, updatedAt: now, role: 'customer', accountType: 'customer' },
    { id: staffId, name: 'Receipt Staff', email: 'receipt-staff@example.test', emailVerified: true, createdAt: now, updatedAt: now, role: 'owner', accountType: 'staff', staffActivatedAt: now },
  ])
  await database.db.update(commerceSettings).set({ shippingFeeSatang: 725, checkoutEnabled: true, version: 2 })
    .where(eq(commerceSettings.id, 1))
  await completeSeller()
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

async function completeSeller() {
  await database.db.update(receiptSettings).set(seller).where(eq(receiptSettings.id, 1))
}

async function clearSeller() {
  await database.db.update(receiptSettings).set({ sellerName: null, sellerTaxId: null }).where(eq(receiptSettings.id, 1))
}

function services() {
  const audit = new AuditService(new AuditRepository(database.db))
  const cart = new CartService(new CartRepository(database.db, new InventoryReadRepository(database.db)))
  const settings = new CommerceSettingsService(new CommerceSettingsRepository(database.db, audit))
  return {
    audit,
    cart,
    quote: new QuoteService(cart, settings, commerceSecret),
    checkout: new CheckoutService(database.db, commerceSecret),
    orders: new OrderService(database.db, commerceSecret),
  }
}

async function seedVariant(vatTreatment: 'standard' | 'exempt' = 'exempt', priceSatang = 1200) {
  const suffix = crypto.randomUUID()
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId,
    slug: `receipts-${suffix}`,
    name: vatTreatment === 'exempt' ? 'Fresh Mango Box' : 'Dried Mango Pack',
    category: vatTreatment === 'exempt' ? 'fresh' : 'processed',
    vatTreatment,
    status: 'published',
  })
  await database.db.insert(productVariant).values({
    id: variantId, productId, sku: `RECEIPT-${suffix}`, name: 'Box', unit: 'box', priceSatang, salesEnabled: true,
  })
  const [mainWarehouse] = await database.db.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.code, 'MAIN'))
  if (!mainWarehouse) throw new Error('Expected MAIN warehouse')
  await database.db.insert(inventoryLot).values({
    id: crypto.randomUUID(),
    warehouseId: mainWarehouse.id,
    variantId,
    lotCode: `RECEIPT-${suffix.slice(0, 8)}`,
    receivedAt: new Date(Date.now() - 86_400_000),
    expiryDate: '2999-12-31',
    onHandQuantity: 10,
  })
  return variantId
}

async function placeCod(vatTreatment: 'standard' | 'exempt' = 'standard') {
  const { cart, quote, checkout } = services()
  const variantId = await seedVariant(vatTreatment, 10700)
  const principal: CartPrincipal = { kind: 'customer', userId: customerId }
  await cart.setItem(principal, variantId, 1)
  const quoteResult = await quote.create(principal, new Date())
  const result = await checkout.placeCod({
    quoteToken: quoteResult.quoteToken,
    paymentMethod: 'cod',
    contact: { email: 'buyer@example.test' },
    billingAddress,
  }, principal, `receipts-cod-${crypto.randomUUID()}`)
  return result.order
}

function stripeGateway(): StripeGateway {
  return {
    checkoutReturnUrls: () => ({
      successUrl: 'https://shop.example.test/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://shop.example.test/checkout/cancel',
    }),
    createCheckout: async (input) => ({
      sessionId: `cs_test_${input.orderId.replaceAll('-', '')}`,
      url: `https://checkout.stripe.com/c/pay/cs_test_${input.orderId.replaceAll('-', '')}`,
      expiresAt: input.expiresAt,
    }),
    retrieveCheckout: async () => { throw new Error('not used') },
    createFullRefund: async () => { throw new Error('not used') },
    retrieveRefund: async () => { throw new Error('not used') },
    async constructEvent(rawBody, signature) {
      if (signature !== 'valid-signature') throw new Error('Invalid signature')
      return JSON.parse(rawBody) as Awaited<ReturnType<StripeGateway['constructEvent']>>
    },
  }
}

async function placeStripe() {
  const { cart, quote } = services()
  const variantId = await seedVariant('exempt', 1200)
  const principal: CartPrincipal = {
    kind: 'guest',
    tokenHash: createHash('sha256').update(crypto.randomUUID()).digest('hex'),
  }
  await cart.setItem(principal, variantId, 1)
  const quoteResult = await quote.create(principal, new Date())
  const result = await new StripeCheckoutService(database.db, commerceSecret, stripeGateway()).place({
    quoteToken: quoteResult.quoteToken,
    paymentMethod: 'stripe',
    contact: { email: 'guest@example.test' },
    billingAddress,
  }, principal, `receipts-stripe-${crypto.randomUUID()}`)
  return { ...result.order, guestAccessToken: result.guestAccessToken! }
}

async function settleStripe(order: { id: string; totalSatang: number }, eventId = `evt_${crypto.randomUUID().replaceAll('-', '')}`) {
  const body = JSON.stringify({
    id: eventId,
    object: 'event',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: { object: {
      id: `cs_test_${order.id.replaceAll('-', '')}`,
      object: 'checkout.session',
      client_reference_id: order.id,
      metadata: { orderId: order.id },
      amount_total: order.totalSatang,
      currency: 'thb',
      status: 'complete',
      payment_status: 'paid',
      payment_intent: `pi_${eventId.slice(4, 20)}`,
    } },
  })
  await new StripeEventService(database.db, stripeGateway()).handle(body, 'valid-signature')
  return eventId
}

async function deliver(orders: OrderService, orderId: string) {
  await orders.advanceFulfillment(orderId, 'processing', staffActor, `receipts-processing-${orderId}`)
  await orders.advanceFulfillment(orderId, 'packed', staffActor, `receipts-packed-${orderId}`)
  await orders.advanceFulfillment(orderId, 'shipped', staffActor, `receipts-shipped-${orderId}`, {
    carrier: 'kerry', trackingNumber: 'KER-123456',
  })
  return orders.advanceFulfillment(orderId, 'delivered', staffActor, `receipts-delivered-${orderId}`)
}

async function receiptOutboxFor(orderId: string) {
  const rows = await database.db.select().from(orderOutbox).where(eq(orderOutbox.orderId, orderId))
  return rows.filter(({ templateId }) => templateId === 'receipt_issued')
}

function receiptsFor(orderId: string) {
  return database.db.select().from(receipt).where(eq(receipt.orderId, orderId))
}

function receiptEvents(orderId: string) {
  return database.db.select().from(orderEvent).where(eq(orderEvent.orderId, orderId))
    .then((events) => events.filter(({ eventType }) => eventType.startsWith('receipt.')))
}

function createAdminApp(role: 'owner' | 'fulfillment' | 'support' | 'customer') {
  const auth = {
    handler: async () => new Response(),
    api: {
      getSession: async () => ({
        session: { id: 'session-1', expiresAt: new Date('2099-01-01T00:00:00Z') },
        user: { id: staffId, accountType: 'staff' as const },
        staff: { role, permissions: [] },
      }),
    },
  } as unknown as Auth
  return new Elysia()
    .use(createErrorHandlingPlugin())
    .use(createAdminOrdersModule(config, auth, services().orders))
}

function createStoreApp(sessionUserId: string | null) {
  const auth = {
    handler: async () => new Response(),
    api: {
      getSession: async () => sessionUserId === null ? null : {
        session: { id: 'session-2', expiresAt: new Date('2099-01-01T00:00:00Z') },
        user: { id: sessionUserId, accountType: 'customer' as const },
      },
    },
  } as unknown as Auth
  const limiter = { consume: async () => ({ allowed: true as const, remaining: 1, retryAfterSeconds: 0 }) }
  return new Elysia()
    .use(createErrorHandlingPlugin())
    .use(createStoreOrdersModule(config, auth, services().orders, limiter as never))
}

function storeReceiptRequest(app: ReturnType<typeof createStoreApp>, orderId: string, headers: Record<string, string> = {}) {
  return app.handle(new Request(`http://localhost/api/v1/store/orders/${orderId}/receipt.pdf`, { headers }))
}

async function expectPdf(response: Response, receiptNumber: string) {
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('application/pdf')
  expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${receiptNumber}.pdf"`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
}

async function paidCodOrder() {
  const { orders } = services()
  const order = await placeCod()
  await orders.collectCod(order.id, order.totalSatang, staffActor, `receipts-pdf-collect-${order.id}`)
  await deliver(orders, order.id)
  const [saved] = await receiptsFor(order.id)
  return { order, receiptNumber: saved!.receiptNumber }
}

function adminRequest(app: ReturnType<typeof createAdminApp>, path: string, options: { body?: unknown; key?: string } = {}) {
  const method = options.body === undefined ? 'GET' : 'POST'
  return app.handle(new Request(`http://localhost/api/v1/admin/orders${path}`, {
    method,
    headers: method === 'POST' ? {
      'content-type': 'application/json',
      origin: config.adminUrl,
      'sec-fetch-site': 'same-site',
      'idempotency-key': options.key ?? crypto.randomUUID(),
    } : {},
    ...(method === 'POST' ? { body: JSON.stringify(options.body) } : {}),
  }))
}

describe('receipt issuance', () => {
  it('stripe settlement issues one receipt with complete settings', async () => {
    const order = await placeStripe()
    await settleStripe(order)

    const rows = await receiptsFor(order.id)
    expect(rows).toHaveLength(1)
    const saved = rows[0]!
    const period = receiptPeriod(saved.issuedAt)
    expect(saved.receiptNumber).toBe(`RC${period}-00001`)
    expect(saved).toMatchObject({ kind: 'abbreviated_tax_invoice', status: 'issued', cancelledAt: null })
    const snapshot = saved.snapshot as unknown as ReceiptSnapshot
    expect(snapshot).toMatchObject({
      version: 1,
      kind: 'abbreviated_tax_invoice',
      receiptNumber: saved.receiptNumber,
      orderNumber: order.orderNumber,
      paymentMethod: 'stripe',
      shippingSatang: 725,
      seller: { name: seller.sellerName, taxId: seller.sellerTaxId, branch: '00000' },
      billing: { name: 'Somchai Buyer', phone: '0812345678', postalCode: '10100' },
      totals: {
        exemptSatang: 1200, vatableSatang: 725, vatSatang: 47, preVatSatang: 678, totalSatang: 1925, vatRateBasisPoints: 700,
      },
    })
    expect(snapshot.lines).toEqual([{
      productName: 'Fresh Mango Box', variantName: 'Box', unit: 'box', quantity: 1,
      unitPriceSatang: 1200, lineTotalSatang: 1200, vatTreatment: 'exempt',
    }])
    expect(snapshot.issuedAt).toBe(saved.issuedAt.toISOString())
    expect(snapshot.paidAt).not.toBeNull()

    const events = await receiptEvents(order.id)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ eventType: 'receipt.issued', actorType: 'system', actorId: null, metadata: { receiptId: saved.id } })
    const queued = await receiptOutboxFor(order.id)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ orderEventId: events[0]!.id, eventType: 'receipt.issued', status: 'pending' })
    const audits = await database.db.select().from(auditLog).where(eq(auditLog.action, 'order.receipt-issued'))
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ targetId: order.id, actorUserId: null, metadata: { receiptId: saved.id } })
  })

  it('redelivered stripe event keeps one receipt', async () => {
    const order = await placeStripe()
    const eventId = await settleStripe(order)
    await settleStripe(order, eventId)
    await settleStripe(order)

    expect(await receiptsFor(order.id)).toHaveLength(1)
    expect((await receiptEvents(order.id)).map(({ eventType }) => eventType)).toEqual(['receipt.issued'])
    expect(await receiptOutboxFor(order.id)).toHaveLength(1)
    const [counter] = await database.db.select().from(receiptCounter)
    expect(counter?.lastValue).toBe(1)
  })

  it('cod placement issues no receipt', async () => {
    const order = await placeCod()
    expect(await receiptsFor(order.id)).toHaveLength(0)
    expect(await receiptEvents(order.id)).toHaveLength(0)
  })

  it('cod delivered then collected issues on collect', async () => {
    const { orders } = services()
    const order = await placeCod()
    await deliver(orders, order.id)
    expect(await receiptsFor(order.id)).toHaveLength(0)

    const collected = await orders.collectCod(order.id, order.totalSatang, staffActor, 'receipts-collect-1')
    const rows = await receiptsFor(order.id)
    expect(rows).toHaveLength(1)
    expect(collected.receipt).toMatchObject({ number: rows[0]!.receiptNumber, status: 'issued', kind: 'abbreviated_tax_invoice' })
    const snapshot = rows[0]!.snapshot as unknown as ReceiptSnapshot
    expect(snapshot.paymentMethod).toBe('cod')
    expect(snapshot.totals).toMatchObject({ exemptSatang: 0, vatableSatang: 11425, vatSatang: 747, totalSatang: 11425 })
    const events = await receiptEvents(order.id)
    expect(events[0]).toMatchObject({ eventType: 'receipt.issued', actorType: 'staff', actorId: staffId })
    const [audit] = await database.db.select().from(auditLog).where(eq(auditLog.action, 'order.receipt-issued'))
    expect(Object.keys(audit!.metadata as object).sort()).toEqual(['actorId', 'operationId', 'receiptId'])
    expect(audit).toMatchObject({ actorUserId: staffId, requestId: auditContext.requestId })
  })

  it('cod collected then delivered issues on delivered', async () => {
    const { orders } = services()
    const order = await placeCod()
    await orders.collectCod(order.id, order.totalSatang, staffActor, 'receipts-collect-first')
    expect(await receiptsFor(order.id)).toHaveLength(0)

    const delivered = await deliver(orders, order.id)
    const rows = await receiptsFor(order.id)
    expect(rows).toHaveLength(1)
    expect(delivered.receipt?.number).toBe(rows[0]!.receiptNumber)
  })

  it('cod delivered only issues nothing', async () => {
    const { orders } = services()
    const order = await placeCod()
    const delivered = await deliver(orders, order.id)
    expect(delivered.receipt).toBeNull()
    expect(await receiptsFor(order.id)).toHaveLength(0)
    expect(await receiptEvents(order.id)).toHaveLength(0)
  })

  it('replayed delivered command keeps one receipt', async () => {
    const { orders } = services()
    const order = await placeCod()
    await orders.collectCod(order.id, order.totalSatang, staffActor, 'receipts-collect-replay')
    await deliver(orders, order.id)
    await orders.advanceFulfillment(order.id, 'delivered', staffActor, `receipts-delivered-${order.id}`)
    await orders.advanceFulfillment(order.id, 'delivered', staffActor, 'receipts-delivered-new-key')
    await orders.collectCod(order.id, order.totalSatang, staffActor, 'receipts-collect-replay')
    await orders.collectCod(order.id, order.totalSatang, staffActor, 'receipts-collect-new-key')

    expect(await receiptsFor(order.id)).toHaveLength(1)
    expect(await receiptEvents(order.id)).toHaveLength(1)
    expect(await receiptOutboxFor(order.id)).toHaveLength(1)
  })

  it('cancelled order never gets a receipt', async () => {
    const { orders } = services()
    const order = await placeCod()
    await orders.cancel(order.id, staffActor, 'receipts-cancel-order')
    await expect(orders.issueReceipt(order.id, staffActor, 'receipts-issue-cancelled'))
      .rejects.toMatchObject({ code: 'RECEIPT_NOT_ELIGIBLE' })

    // Collected but cancelled before delivery: still never eligible.
    const collectedOrder = await placeCod()
    await orders.collectCod(collectedOrder.id, collectedOrder.totalSatang, staffActor, 'receipts-collect-cancelled')
    await orders.cancel(collectedOrder.id, staffActor, 'receipts-cancel-collected')
    await expect(orders.issueReceipt(collectedOrder.id, staffActor, 'receipts-issue-collected'))
      .rejects.toMatchObject({ code: 'RECEIPT_NOT_ELIGIBLE' })
    expect(await receiptsFor(order.id)).toHaveLength(0)
    expect(await receiptsFor(collectedOrder.id)).toHaveLength(0)
    expect(await database.db.select().from(receiptCounter)).toHaveLength(0)
  })

  it('incomplete settings defer then manual issue succeeds', async () => {
    await clearSeller()
    const order = await placeStripe()
    await settleStripe(order)
    expect(await receiptsFor(order.id)).toHaveLength(0)

    // A second trigger while still incomplete records no extra deferral.
    await database.db.transaction(async (tx) => {
      expect(await issueReceiptInTransaction(tx, order.id, { type: 'system' })).toBe('deferred')
    })
    const deferred = await receiptEvents(order.id)
    expect(deferred).toHaveLength(1)
    expect(deferred[0]).toMatchObject({ eventType: 'receipt.deferred', actorType: 'system', metadata: {} })

    const app = createAdminApp('owner')
    const incomplete = await adminRequest(app, `/${order.id}/receipt`, { body: {} })
    expect(incomplete.status).toBe(409)
    expect(await incomplete.json()).toMatchObject({ code: 'RECEIPT_SETTINGS_INCOMPLETE' })
    expect(await receiptEvents(order.id)).toHaveLength(1)

    await completeSeller()
    const issued = await adminRequest(app, `/${order.id}/receipt`, { body: {}, key: 'receipts-manual-1' })
    expect(issued.status).toBe(200)
    const body = await issued.json() as { receipt: { number: string; status: string } }
    expect(body.receipt.number).toStartWith(`RC${receiptPeriod(new Date())}-`)
    expect(body.receipt.status).toBe('issued')
    const replay = await adminRequest(app, `/${order.id}/receipt`, { body: {}, key: 'receipts-manual-1' })
    expect((await replay.json() as typeof body).receipt.number).toBe(body.receipt.number)
    const again = await adminRequest(app, `/${order.id}/receipt`, { body: {} })
    expect(again.status).toBe(200)
    expect(await receiptsFor(order.id)).toHaveLength(1)
    expect((await receiptEvents(order.id)).map(({ eventType }) => eventType).sort())
      .toEqual(['receipt.deferred', 'receipt.issued'])
  })

  it('manual issue on an ineligible order returns 409 RECEIPT_NOT_ELIGIBLE', async () => {
    const order = await placeCod()
    const app = createAdminApp('fulfillment')
    const response = await adminRequest(app, `/${order.id}/receipt`, { body: {} })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'RECEIPT_NOT_ELIGIBLE' })
    expect((await adminRequest(createAdminApp('support'), `/${order.id}/receipt`, { body: {} })).status).toBe(403)
    expect(await receiptsFor(order.id)).toHaveLength(0)
  })

  it('issues gap-free numbers under concurrent settlement', async () => {
    const orders = []
    for (let index = 0; index < 5; index += 1) orders.push(await placeStripe())
    await Promise.all(orders.map((order) => settleStripe(order)))

    const rows = await database.db.select().from(receipt)
    expect(rows).toHaveLength(5)
    const period = receiptPeriod(new Date())
    expect(rows.map(({ receiptNumber }) => receiptNumber).sort())
      .toEqual([1, 2, 3, 4, 5].map((value) => `RC${period}-0000${value}`))
    expect(new Set(rows.map(({ orderId }) => orderId)).size).toBe(5)
  })

  it('cancel marks receipt cancelled, keeps number, requires order:refund', async () => {
    const order = await placeStripe()
    await settleStripe(order)
    const [issued] = await receiptsFor(order.id)

    const forbidden = await adminRequest(createAdminApp('fulfillment'), `/${order.id}/receipt/cancel`, {
      body: { reason: 'Refunded to customer' },
    })
    expect(forbidden.status).toBe(403)
    const app = createAdminApp('owner')
    expect((await adminRequest(app, `/${order.id}/receipt/cancel`, { body: { reason: '' } })).status).toBe(422)

    const cancelled = await adminRequest(app, `/${order.id}/receipt/cancel`, {
      body: { reason: '  Refunded to customer  ' }, key: 'receipts-cancel-1',
    })
    expect(cancelled.status).toBe(200)
    const body = await cancelled.json() as { receipt: { number: string; status: string } }
    expect(body.receipt).toMatchObject({ number: issued!.receiptNumber, status: 'cancelled' })
    const again = await adminRequest(app, `/${order.id}/receipt/cancel`, { body: { reason: 'Second try' } })
    expect(again.status).toBe(200)

    const [saved] = await receiptsFor(order.id)
    expect(saved).toMatchObject({
      receiptNumber: issued!.receiptNumber, status: 'cancelled', cancelledBy: staffId, cancelReason: 'Refunded to customer',
    })
    expect(saved!.snapshot).toEqual(issued!.snapshot)
    expect(saved!.cancelledAt).toBeInstanceOf(Date)
    const events = (await receiptEvents(order.id)).filter(({ eventType }) => eventType === 'receipt.cancelled')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ actorType: 'staff', actorId: staffId, metadata: { receiptId: saved!.id } })
    const audits = await database.db.select().from(auditLog).where(eq(auditLog.action, 'order.receipt-cancelled'))
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain('Refunded')

    const missing = await placeCod()
    const notFound = await adminRequest(app, `/${missing.id}/receipt/cancel`, { body: { reason: 'No receipt' } })
    expect(notFound.status).toBe(404)
    expect(await notFound.json()).toMatchObject({ code: 'RECEIPT_NOT_FOUND' })

    await expect(database.db.delete(receipt).where(eq(receipt.id, saved!.id)).execute()).rejects.toThrow()
  })

  it('snapshot is immune to later seller settings edits', async () => {
    const order = await placeStripe()
    await settleStripe(order)
    const [before] = await receiptsFor(order.id)

    const { audit } = services()
    await new ReceiptSettingsService(new ReceiptSettingsRepository(database.db, audit)).update({
      name: 'ร้านใหม่', taxId: seller.sellerTaxId, branch: '00001', addressLine1: '1 New Road', addressLine2: null,
      subdistrict: 'Silom', district: 'Bang Rak', province: 'Bangkok', postalCode: '10500', phone: null,
    }, { userId: staffId, auditContext })

    const [after] = await receiptsFor(order.id)
    expect(after!.snapshot).toEqual(before!.snapshot)
    expect((after!.snapshot as unknown as ReceiptSnapshot).seller).toMatchObject({ name: seller.sellerName, branch: '00000' })
    await expect(database.db.update(receipt).set({ snapshot: { tampered: true } })
      .where(eq(receipt.id, after!.id)).execute()).rejects.toThrow()
  })

  it('order detail exposes receipt summary', async () => {
    const { orders } = services()
    const order = await placeStripe()
    const pending = await orders.getForPrincipal(order.id, staffActor)
    expect(pending.receipt).toBeNull()

    await settleStripe(order)
    const [saved] = await receiptsFor(order.id)
    const summary = {
      number: saved!.receiptNumber,
      kind: 'abbreviated_tax_invoice' as const,
      status: 'issued' as const,
      issuedAt: saved!.issuedAt.toISOString(),
    }
    expect((await orders.getForPrincipal(order.id, staffActor)).receipt).toEqual(summary)
    expect((await orders.getStoreOrder(order.id, staffActor)).receipt).toEqual(summary)
    const response = await adminRequest(createAdminApp('support'), `/${order.id}`)
    expect(response.status).toBe(200)
    expect((await response.json() as { receipt: unknown }).receipt).toEqual(summary)
  })
})

describe('receipt pdf download', () => {
  it('customer downloads own receipt pdf', async () => {
    const { order, receiptNumber } = await paidCodOrder()
    await expectPdf(await storeReceiptRequest(createStoreApp(customerId), order.id), receiptNumber)
  })

  it('guest download requires X-Order-Access-Token', async () => {
    const order = await placeStripe()
    await settleStripe(order)
    const [saved] = await receiptsFor(order.id)
    const app = createStoreApp(null)

    const missing = await storeReceiptRequest(app, order.id)
    expect(missing.status).toBe(404)
    expect((await missing.json() as { code: string }).code).toBe('ORDER_NOT_FOUND')
    expect((await storeReceiptRequest(app, order.id, { 'x-order-access-token': 'wrong-token' })).status).toBe(404)
    await expectPdf(
      await storeReceiptRequest(app, order.id, { 'x-order-access-token': order.guestAccessToken }),
      saved!.receiptNumber,
    )
  })

  it('other customer gets 404', async () => {
    const { order } = await paidCodOrder()
    const response = await storeReceiptRequest(createStoreApp('someone-else'), order.id)
    expect(response.status).toBe(404)
    expect((await response.json() as { code: string }).code).toBe('ORDER_NOT_FOUND')
  })

  it('no receipt returns 404', async () => {
    const order = await placeCod()
    const response = await storeReceiptRequest(createStoreApp(customerId), order.id)
    expect(response.status).toBe(404)
    expect((await response.json() as { code: string }).code).toBe('RECEIPT_NOT_FOUND')
  })

  it('admin download requires order:read', async () => {
    const { order, receiptNumber } = await paidCodOrder()
    const path = `/${order.id}/receipt.pdf`
    expect((await adminRequest(createAdminApp('customer'), path)).status).toBe(403)
    await expectPdf(await adminRequest(createAdminApp('support'), path), receiptNumber)

    const unreceipted = await placeCod()
    const missing = await adminRequest(createAdminApp('owner'), `/${unreceipted.id}/receipt.pdf`)
    expect(missing.status).toBe(404)
    expect((await missing.json() as { code: string }).code).toBe('RECEIPT_NOT_FOUND')
  })

  it('cancelled receipt still downloads', async () => {
    const { orders } = services()
    const { order, receiptNumber } = await paidCodOrder()
    await orders.cancelReceipt(order.id, 'mistake', staffActor, 'receipts-pdf-cancel')
    await expectPdf(await adminRequest(createAdminApp('owner'), `/${order.id}/receipt.pdf`), receiptNumber)
  })
})
