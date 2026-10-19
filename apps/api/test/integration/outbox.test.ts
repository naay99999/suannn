import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  auditLog,
  commerceOrder,
  commerceSettings,
  inventoryLot,
  orderEvent,
  orderOperation,
  orderOutbox,
  product,
  productVariant,
  receipt,
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
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'
import * as orderAccessModule from '../../src/modules/orders/access'
import { OrderService } from '../../src/modules/orders/service'
import { enqueueOrderEmail } from '../../src/modules/orders/outbox'
import type { ReceiptSnapshot } from '../../src/modules/receipts/types'
import type { EmailMessage, EmailSender } from '../../src/modules/email/sender'
import { MediaUrls } from '../../src/modules/media/urls'

const database = createTestDatabase()
const commerceSecret = new Uint8Array(32).fill(43)
const customerId = 'outbox-customer'
const otherCustomerId = 'outbox-other-customer'
const staffId = 'outbox-staff'
const staffActor = {
  kind: 'staff' as const,
  userId: staffId,
  auditContext: { requestId: 'outbox-test', ipAddress: '127.0.0.1', userAgent: 'test' },
}
let unlockDatabase: (() => Promise<void>) | undefined

const accessExports = orderAccessModule as unknown as Record<string, unknown>
const outboxModule = await import('../../src/modules/orders/outbox').catch(() => ({}))
const outboxExports = outboxModule as unknown as Record<string, unknown>

type OrderAccessInstance = { verify(orderId: string, token: string | undefined, now: Date): Promise<unknown> }
type OrderOutboxInstance = { processBatch(limit: number): Promise<number> }
type OrderAccessConstructor = new (db: typeof database.db) => OrderAccessInstance
type OrderOutboxConstructor = new (
  db: typeof database.db,
  sender: EmailSender,
  secret: Uint8Array,
  storefrontUrl: string,
) => OrderOutboxInstance

type GuestAccessCommands = {
  reissueGuestAccess(orderId: string, reasonCode: string, actor: typeof staffActor, key: string): Promise<unknown>
  revokeGuestAccess(orderId: string, reasonCode: string, actor: typeof staffActor, key: string): Promise<unknown>
}

function guestPrincipal(seed: string = crypto.randomUUID()): CartPrincipal {
  return { kind: 'guest', tokenHash: createHash('sha256').update(seed).digest('hex') }
}

async function createCustomer(id: string): Promise<CartPrincipal> {
  const now = new Date()
  await database.db.insert(user).values({
    id,
    name: 'Outbox Customer',
    email: `${id}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    role: 'customer',
    accountType: 'customer',
  })
  return { kind: 'customer', userId: id }
}

function createCheckoutServices() {
  const audit = new AuditService(new AuditRepository(database.db))
  const settings = new CommerceSettingsService(new CommerceSettingsRepository(database.db, audit))
  const cartService = new CartService(new CartRepository(database.db, new InventoryReadRepository(database.db), new MediaUrls(null)))
  const quote = new QuoteService(cartService, settings, commerceSecret)
  const checkout = new CheckoutService(database.db, commerceSecret)
  return { cartService, quote, checkout }
}

function testStripeGateway(): StripeGateway {
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

async function placeOrder(principal: CartPrincipal = guestPrincipal()) {
  const suffix = crypto.randomUUID()
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId,
    slug: `outbox-${suffix}`,
    name: 'Outbox Fruit Box',
    category: 'fresh', vatTreatment: 'exempt',
    status: 'published',
  })
  await database.db.insert(productVariant).values({
    id: variantId,
    productId,
    sku: `OUTBOX-${suffix}`,
    name: 'Small box',
    unit: 'box',
    priceSatang: 1200,
    salesEnabled: true,
  })
  const [mainWarehouse] = await database.db.select({ id: warehouse.id })
    .from(warehouse).where(eq(warehouse.code, 'MAIN'))
  if (!mainWarehouse) throw new Error('Expected MAIN warehouse')
  await database.db.insert(inventoryLot).values({
    id: crypto.randomUUID(),
    warehouseId: mainWarehouse.id,
    variantId,
    lotCode: `OUTBOX-${suffix.slice(0, 8)}`,
    expiryDate: '2999-12-31',
    onHandQuantity: 8,
  })

  const { cartService, quote, checkout } = createCheckoutServices()
  await cartService.setItem(principal, variantId, 1)
  const currentQuote = await quote.create(principal, new Date())
  const input = {
    quoteToken: currentQuote.quoteToken,
    paymentMethod: 'cod' as const,
    contact: { email: 'buyer@example.test' },
    billingAddress: {
      recipientName: 'Somchai Buyer',
      addressLine1: '12 Orchard Road',
      subdistrict: 'Talat Noi',
      district: 'Samphanthawong',
      province: 'Bangkok',
      postalCode: '10100',
      phone: '0812345678',
    },
  }
  const idempotencyKey = `outbox-checkout-${crypto.randomUUID()}`
  const stripeGateway = principal.kind === 'guest' ? testStripeGateway() : null
  const stripeCheckout = stripeGateway
    ? new StripeCheckoutService(database.db, commerceSecret, stripeGateway)
    : null
  const result = stripeCheckout
    ? await stripeCheckout.place({ ...input, paymentMethod: 'stripe' }, principal, idempotencyKey)
    : await checkout.placeCod(input, principal, idempotencyKey)

  if (stripeGateway && stripeCheckout) {
    await new StripeEventService(database.db, stripeGateway).handle(JSON.stringify({
      id: `evt_paid${result.order.id.replaceAll('-', '')}`,
      type: 'checkout.session.completed',
      data: { object: {
        id: `cs_test_${result.order.id}`,
        client_reference_id: result.order.id,
        metadata: { orderId: result.order.id },
        amount_total: result.order.totalSatang,
        currency: 'thb',
        payment_intent: `pi_test_${result.order.id.replaceAll('-', '')}`,
        status: 'complete',
        payment_status: 'paid',
      } },
    }), 'valid-signature')
  }

  return { result, principal, checkout, stripeCheckout, input, idempotencyKey }
}

function makeSender(send: EmailSender['send']): EmailSender {
  return { send }
}

function makeAccess(): OrderAccessInstance {
  const Access = accessExports.OrderAccess as OrderAccessConstructor | undefined
  expect(typeof Access).toBe('function')
  if (!Access) throw new Error('OrderAccess is not implemented')
  return new Access(database.db)
}

function makeOutbox(sender: EmailSender): OrderOutboxInstance {
  const Outbox = outboxExports.OrderOutbox as OrderOutboxConstructor | undefined
  expect(typeof Outbox).toBe('function')
  if (!Outbox) throw new Error('OrderOutbox is not implemented')
  return new Outbox(database.db, sender, commerceSecret, 'https://shop.example.test')
}

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

beforeEach(async () => {
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  await createCustomer(customerId)
  await createCustomer(otherCustomerId)
  const now = new Date()
  await database.db.insert(user).values({
    id: staffId,
    name: 'Outbox Staff',
    email: `${staffId}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    role: 'admin',
    accountType: 'staff',
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

describe('guest order access and confirmation outbox', () => {
  it('returns one not-found outcome for missing, invalid, customer-owned, and expired guest access', async () => {
    const guest = await placeOrder()
    const anotherGuest = await placeOrder()
    const customer = await placeOrder({ kind: 'customer', userId: customerId })
    const access = makeAccess()
    const orderService = new OrderService(database.db)
    const now = new Date('2026-07-01T00:00:00.000Z')
    await database.db.update(commerceOrder).set({ status: 'delivered', terminalAt: new Date(now.getTime() - 30 * 86_400_000 - 1) })
      .where(eq(commerceOrder.id, guest.result.order.id))

    const attempts = [
      () => access.verify(crypto.randomUUID(), 'unknown-token', now),
      () => access.verify(guest.result.order.id, undefined, now),
      () => access.verify(guest.result.order.id, 'wrong-token', now),
      () => access.verify(guest.result.order.id, anotherGuest.result.guestAccessToken!, now),
      () => access.verify(customer.result.order.id, guest.result.guestAccessToken!, now),
      () => access.verify(guest.result.order.id, guest.result.guestAccessToken!, now),
    ]
    const errors: unknown[] = []
    for (const attempt of attempts) {
      try { await attempt() } catch (error) { errors.push(error) }
    }

    expect(errors).toHaveLength(6)
    expect(errors.map((error) => ({
      code: (error as { code?: string }).code,
      status: (error as { status?: number }).status,
      publicMessage: (error as { publicMessage?: string }).publicMessage,
    }))).toEqual(Array.from({ length: 6 }, () => ({
      code: 'ORDER_NOT_FOUND',
      status: 404,
      publicMessage: 'Order not found',
    })))
    await expect(orderService.getForPrincipal(guest.result.order.id, {
      kind: 'guest', accessToken: anotherGuest.result.guestAccessToken!,
    })).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })
    await expect(orderService.getForPrincipal(customer.result.order.id, {
      kind: 'customer', userId: otherCustomerId,
    })).rejects.toMatchObject({ code: 'ORDER_ACCESS_DENIED' })
    await expect(orderService.getForPrincipal(guest.result.order.id, {
      kind: 'guest', accessToken: '',
    })).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })
  })

  it('allows guest access through exactly 30 days after terminal fulfillment', async () => {
    const guest = await placeOrder()
    const terminalAt = new Date('2026-01-01T00:00:00.000Z')
    await database.db.update(commerceOrder).set({ status: 'delivered', terminalAt })
      .where(eq(commerceOrder.id, guest.result.order.id))

    const order = await makeAccess().verify(
      guest.result.order.id,
      guest.result.guestAccessToken!,
      new Date('2026-01-31T00:00:00.000Z'),
    )

    expect(order).toMatchObject({ id: guest.result.order.id, status: 'delivered' })
  })

  it('reissues a guest token idempotently and invalidates the previous token without auditing secrets', async () => {
    const guest = await placeOrder()
    const service = new OrderService(database.db, commerceSecret) as unknown as GuestAccessCommands
    const previousToken = guest.result.guestAccessToken!
    const [previousOrder] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, guest.result.order.id))

    await makeAccess().verify(guest.result.order.id, previousToken, new Date())
    const first = await service.reissueGuestAccess(guest.result.order.id, 'support_recovery', staffActor, 'reissue-1')
    const replay = await service.reissueGuestAccess(guest.result.order.id, 'support_recovery', staffActor, 'reissue-1')
    await expect(service.reissueGuestAccess(guest.result.order.id, 'suspected_compromise', staffActor, 'reissue-1'))
      .rejects.toMatchObject({ code: 'ORDER_OPERATION_CONFLICT' })
    await expect(makeAccess().verify(guest.result.order.id, previousToken, new Date()))
      .rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })

    const events = await database.db.select().from(orderEvent).where(eq(orderEvent.orderId, guest.result.order.id))
    const audits = await database.db.select().from(auditLog).where(eq(auditLog.targetId, guest.result.order.id))
    const operations = await database.db.select().from(orderOperation)
    const outbox = await database.db.select().from(orderOutbox).where(eq(orderOutbox.orderId, guest.result.order.id))
    const [savedOrder] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, guest.result.order.id))
    const messages: EmailMessage[] = []
    const delivered = await makeOutbox(makeSender(async (message) => {
      messages.push(message)
      return { id: 'reissued-token-message' }
    })).processBatch(10)
    const deliveredToken = messages[1]?.text.split('\n').at(-1)

    expect(first).toEqual(replay)
    expect(events.filter(({ eventType }) => eventType === 'order.guest-access-reissued')).toHaveLength(1)
    expect(audits.filter(({ action }) => action === 'order.guest-access-reissued')).toHaveLength(1)
    expect(audits.find(({ action }) => action === 'order.guest-access-reissued')?.metadata)
      .toMatchObject({ reasonCode: 'support_recovery' })
    expect(outbox).toHaveLength(2)
    expect(JSON.stringify({ audits, operations })).not.toContain(previousToken)
    expect(savedOrder?.guestAccessTokenHash).not.toBe(previousOrder?.guestAccessTokenHash)
    expect(delivered).toBe(2)
    expect(deliveredToken).toBeString()
    expect(deliveredToken).not.toBe(previousToken)
    expect(messages[1]?.text).toContain(deliveredToken!)
    expect(messages[1]?.text).toContain(`https://shop.example.test/orders/guest/${guest.result.order.id}`)
    expect(messages[1]?.html).toContain(`https://shop.example.test/orders/guest/${guest.result.order.id}`)
    expect(messages[1]?.html).not.toContain(`href="https://shop.example.test/orders/guest/${guest.result.order.id}?token=`)
    await makeAccess().verify(guest.result.order.id, deliveredToken, new Date())
    expect(JSON.stringify({ first, replay, audits, operations })).not.toContain(deliveredToken!)
    await expect((async () => {
      await database.client.unsafe(
        'update commerce_order set contact_email = $1 where id = $2',
        ['changed@example.test', guest.result.order.id],
      )
    })()).rejects.toMatchObject({ code: '23514' })
  })

  it('revokes guest access idempotently and stops queued confirmation delivery', async () => {
    const guest = await placeOrder()
    const service = new OrderService(database.db, commerceSecret) as unknown as GuestAccessCommands
    const sender = makeSender(async () => ({ id: 'should-not-send' }))

    await service.revokeGuestAccess(guest.result.order.id, 'suspected_compromise', staffActor, 'revoke-1')
    await service.revokeGuestAccess(guest.result.order.id, 'suspected_compromise', staffActor, 'revoke-1')
    await expect(makeAccess().verify(guest.result.order.id, guest.result.guestAccessToken!, new Date()))
      .rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })
    const attempted = await makeOutbox(sender).processBatch(10)
    const audits = await database.db.select().from(auditLog).where(eq(auditLog.targetId, guest.result.order.id))
    const outbox = await database.db.select().from(orderOutbox).where(eq(orderOutbox.orderId, guest.result.order.id))

    expect(attempted).toBe(0)
    expect(audits.filter(({ action }) => action === 'order.guest-access-revoked')).toHaveLength(1)
    expect(audits.find(({ action }) => action === 'order.guest-access-revoked')?.metadata)
      .toMatchObject({ reasonCode: 'suspected_compromise' })
    expect(outbox[0]).toMatchObject({ status: 'failed', lastErrorCode: 'ACCESS_REVOKED' })
  })

  it('does not create duplicate confirmation intent when checkout is replayed', async () => {
    const guest = guestPrincipal('stable-outbox-owner')
    const placed = await placeOrder(guest)
    const result = await placed.stripeCheckout!.place({ ...placed.input, paymentMethod: 'stripe' }, guest, placed.idempotencyKey)
    const outbox = await database.db.select().from(orderOutbox).where(eq(orderOutbox.orderId, placed.result.order.id))

    expect(result).toMatchObject(placed.result)
    expect(outbox).toHaveLength(1)
  })

  it('retries failed email delivery with capped backoff and sends the regenerated token', async () => {
    const guest = await placeOrder()
    const errors: string[] = []
    const sender = makeSender(async (message) => {
      errors.push(message.text)
      if (errors.length === 1) throw new Error('buyer@example.test / secret data must not persist')
      return { id: 'email-accepted-1' }
    })
    const worker = makeOutbox(sender)
    const firstBatch = await worker.processBatch(10)
    const [failed] = await database.db.select().from(orderOutbox).where(eq(orderOutbox.orderId, guest.result.order.id))

    expect(firstBatch).toBe(1)
    expect(failed).toMatchObject({ status: 'failed', attemptCount: 1, lastErrorCode: 'EMAIL_DELIVERY_FAILED' })
    expect(failed?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
    expect(failed?.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000)
    expect(JSON.stringify(failed)).not.toContain('buyer@example.test')
    expect(JSON.stringify(failed)).not.toContain('secret data')

    await database.db.update(orderOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(orderOutbox.orderId, guest.result.order.id))
    const retryBatch = await worker.processBatch(10)
    const [sent] = await database.db.select().from(orderOutbox).where(eq(orderOutbox.orderId, guest.result.order.id))

    expect(retryBatch).toBe(1)
    expect(sent).toMatchObject({ status: 'sent', attemptCount: 2, lastErrorCode: null })
    expect(errors[1]).toContain(guest.result.guestAccessToken!)
    expect(errors[1]).toContain(guest.result.order.orderNumber)
    expect(errors[1]).toContain(`https://shop.example.test/orders/guest/${guest.result.order.id}`)
  })

  it('caps retry delay when repeated delivery failures occur', async () => {
    const guest = await placeOrder()
    const sender = makeSender(async () => { throw new Error('private provider message') })
    await database.db.update(orderOutbox).set({ attemptCount: 20, nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(orderOutbox.orderId, guest.result.order.id))

    await makeOutbox(sender).processBatch(1)

    const [failed] = await database.db.select().from(orderOutbox).where(eq(orderOutbox.orderId, guest.result.order.id))
    expect(failed?.attemptCount).toBe(21)
    expect(failed?.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000 + 1000)
    expect(failed?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60 * 1000 - 1000)
  })

  it('allows only one worker to claim a due row at a time', async () => {
    const guest = await placeOrder()
    let releaseSend: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const blocked = new Promise<void>((resolve) => { releaseSend = resolve })
    const sender = makeSender(async () => {
      const [claimed] = await database.db.select().from(orderOutbox)
        .where(eq(orderOutbox.orderId, guest.result.order.id))
      expect(claimed?.status).toBe('processing')
      markStarted?.()
      await blocked
      return { id: 'email-accepted-2' }
    })
    const workerA = makeOutbox(sender)
    const workerB = makeOutbox(sender)
    const first = workerA.processBatch(1)
    await started
    const second = await workerB.processBatch(1)
    releaseSend?.()
    const firstResult = await first

    expect(firstResult).toBe(1)
    expect(second).toBe(0)
  })

  it('emails customers in Thai when their order ships or is cancelled', async () => {
    const shipped = await placeOrder({ kind: 'customer', userId: customerId })
    const cancelled = await placeOrder({ kind: 'customer', userId: customerId })
    const orders = new OrderService(database.db)
    await orders.advanceFulfillment(shipped.result.order.id, 'processing', staffActor, 'mail-processing')
    await orders.advanceFulfillment(shipped.result.order.id, 'packed', staffActor, 'mail-packed')
    await orders.advanceFulfillment(shipped.result.order.id, 'shipped', staffActor, 'mail-shipped', { carrier: 'flash', trackingNumber: 'TH0123456789' })
    await orders.cancel(cancelled.result.order.id, { kind: 'customer', userId: customerId }, 'mail-cancel')

    const messages: EmailMessage[] = []
    await makeOutbox(makeSender(async (message) => {
      messages.push(message)
      return { id: `email-${messages.length}` }
    })).processBatch(10)

    const shippedMail = messages.find(message => message.template === 'order-shipped')
    const cancelledMail = messages.find(message => message.template === 'order-cancelled')
    expect(messages.filter(message => message.template === 'order-confirmation')).toHaveLength(2)
    expect(shippedMail?.subject).toContain('จัดส่งแล้ว')
    expect(shippedMail?.text).toContain('Flash Express')
    expect(shippedMail?.text).toContain('TH0123456789')
    expect(shippedMail?.text).toContain(`https://shop.example.test/account/orders/${shipped.result.order.id}`)
    expect(cancelledMail?.subject).toContain('ยกเลิก')
    const outbox = await database.db.select().from(orderOutbox)
    expect(outbox.every(row => row.status === 'sent')).toBe(true)
  })

  async function queueReceipt(orderId: string, orderNumber: string, withReceipt: boolean, status: 'issued' | 'cancelled' = 'issued') {
    const eventId = crypto.randomUUID()
    await database.db.transaction(async (tx) => {
      await tx.insert(orderEvent).values({
        id: eventId, orderId, eventType: 'receipt.issued', actorType: 'system', actorId: null, metadata: {},
      })
      if (withReceipt) {
        const snapshot: ReceiptSnapshot = {
          version: 1,
          kind: 'receipt',
          receiptNumber: 'RC202610-00001',
          issuedAt: new Date().toISOString(),
          paidAt: null,
          seller: {
            name: 'Seller Co', taxId: '0105536092641', branch: '00000',
            addressLine1: '99 Road', addressLine2: null, subdistrict: 'A', district: 'B', province: 'C', postalCode: '10110', phone: null,
          },
          billing: {
            name: 'Buyer', phone: '0812345678', addressLine1: '1 St', addressLine2: null,
            subdistrict: 'A', district: 'B', province: 'C', postalCode: '10100',
          },
          orderNumber,
          paymentMethod: 'stripe',
          lines: [{
            productName: 'Fruit', variantName: 'Box', unit: 'box', quantity: 1,
            unitPriceSatang: 1200, lineTotalSatang: 1200, vatTreatment: 'exempt',
          }],
          shippingSatang: 0,
          totals: { exemptSatang: 1200, vatableSatang: 0, vatSatang: 0, preVatSatang: 0, totalSatang: 1200, vatRateBasisPoints: 700 },
        }
        await tx.insert(receipt).values({
          orderId, receiptNumber: 'RC202610-00001', kind: 'receipt', status,
          issuedAt: new Date(), snapshot: snapshot as unknown as Record<string, unknown>,
          ...(status === 'cancelled' ? { cancelledAt: new Date(), cancelledBy: staffId, cancelReason: 'test' } : {}),
        })
      }
      await enqueueOrderEmail(tx, { orderId, orderEventId: eventId, eventType: 'receipt.issued', templateId: 'receipt_issued' })
    })
  }

  it('delivers receipt_issued with one pdf attachment', async () => {
    const placed = await placeOrder({ kind: 'customer', userId: customerId })
    await database.db.delete(orderOutbox)
    await queueReceipt(placed.result.order.id, placed.result.order.orderNumber, true)

    const messages: EmailMessage[] = []
    await makeOutbox(makeSender(async (message) => {
      messages.push(message)
      return { id: 'r1' }
    })).processBatch(10)

    expect(messages).toHaveLength(1)
    const message = messages[0]!
    expect(message.template).toBe('receipt-issued')
    expect(message.subject).toBe(`ใบเสร็จรับเงิน คำสั่งซื้อ ${placed.result.order.orderNumber}`)
    expect(message.text).toContain(`https://shop.example.test/account/orders/${placed.result.order.id}`)
    expect(message.attachments).toHaveLength(1)
    expect(message.attachments![0]!.filename).toBe('RC202610-00001.pdf')
    expect(Buffer.from(message.attachments![0]!.content.subarray(0, 5)).toString()).toBe('%PDF-')
    const [row] = await database.db.select().from(orderOutbox)
    expect(row?.status).toBe('sent')
  })

  it('receipt_issued for a missing receipt marks the row failed with OUTBOX_RECEIPT_MISSING', async () => {
    const placed = await placeOrder({ kind: 'customer', userId: customerId })
    await database.db.delete(orderOutbox)
    await queueReceipt(placed.result.order.id, placed.result.order.orderNumber, false)

    const messages: EmailMessage[] = []
    await makeOutbox(makeSender(async (message) => {
      messages.push(message)
      return { id: 'r1' }
    })).processBatch(10)

    expect(messages).toHaveLength(0)
    const [row] = await database.db.select().from(orderOutbox)
    expect(row).toMatchObject({ status: 'failed', lastErrorCode: 'OUTBOX_RECEIPT_MISSING' })
  })

  it('receipt_issued for a receipt cancelled before delivery sends nothing and marks the row sent', async () => {
    const placed = await placeOrder({ kind: 'customer', userId: customerId })
    await database.db.delete(orderOutbox)
    await queueReceipt(placed.result.order.id, placed.result.order.orderNumber, true, 'cancelled')

    const messages: EmailMessage[] = []
    await makeOutbox(makeSender(async (message) => {
      messages.push(message)
      return { id: 'r1' }
    })).processBatch(10)

    expect(messages).toHaveLength(0)
    const [row] = await database.db.select().from(orderOutbox)
    expect(row).toMatchObject({ status: 'sent', lastErrorCode: 'RECEIPT_CANCELLED' })
    expect(row?.sentAt).not.toBeNull()
  })
})
