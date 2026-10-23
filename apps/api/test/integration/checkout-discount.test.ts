import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import {
  commerceOrder,
  commerceSettings,
  discountCode,
  inventoryLot,
  orderItem,
  product,
  productVariant,
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
import { DiscountRepository } from '../../src/modules/discounts/repository'
import { DiscountService } from '../../src/modules/discounts/service'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { MediaUrls } from '../../src/modules/media/urls'
import type { StripeGateway } from '../../src/modules/payments/stripe/gateway'
import { OrderService } from '../../src/modules/orders/service'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const commerceSecret = new Uint8Array(32).fill(31)
const shippingFee = 725
const customerA = { id: 'checkout-discount-a', email: 'buyer-a@example.test' }
const customerB = { id: 'checkout-discount-b', email: 'buyer-b@example.test' }
let unlockDatabase: (() => Promise<void>) | undefined
let freshVariantId: string
let processedVariantId: string

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
})

beforeEach(async () => {
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values([customerA, customerB].map((account) => ({
    id: account.id, name: account.id, email: account.email, emailVerified: true,
    createdAt: now, updatedAt: now, role: 'customer' as const, accountType: 'customer' as const,
  })))
  await database.db.update(commerceSettings).set({
    shippingFeeSatang: shippingFee, checkoutEnabled: true, version: 2,
  }).where(eq(commerceSettings.id, 1))
  freshVariantId = await seedVariant('fresh', 1000)
  processedVariantId = await seedVariant('processed', 3000)
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

function futureDate(days = 30) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function seedVariant(category: 'fresh' | 'processed', priceSatang: number) {
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId, slug: `checkout-discount-${productId}`, name: `Product ${category}`, category,
    vatTreatment: 'exempt', status: 'published',
  })
  await database.db.insert(productVariant).values({
    id: variantId, productId, sku: `CDISC-${variantId}`, name: 'Box', unit: 'box', priceSatang, salesEnabled: true,
  })
  const [mainWarehouse] = await database.db.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.code, 'MAIN'))
  await database.db.insert(inventoryLot).values({
    id: crypto.randomUUID(), warehouseId: mainWarehouse!.id, variantId, lotCode: `CDISC-${variantId.slice(0, 8)}`,
    receivedAt: new Date(Date.now() - 86_400_000), expiryDate: futureDate(), onHandQuantity: 50,
  })
  return variantId
}

function services() {
  const audit = new AuditService(new AuditRepository(database.db))
  const cart = new CartService(new CartRepository(database.db, new InventoryReadRepository(database.db), new MediaUrls(null)))
  const settings = new CommerceSettingsService(new CommerceSettingsRepository(database.db, audit))
  const discounts = new DiscountService(new DiscountRepository(database.db, audit), settings)
  return {
    cart,
    quote: new QuoteService(cart, settings, commerceSecret, discounts),
    checkout: new CheckoutService(database.db, commerceSecret),
    orders: new OrderService(database.db),
  }
}

function customerPrincipal(account: { id: string }): CartPrincipal {
  return { kind: 'customer', userId: account.id }
}

function guestPrincipal(): CartPrincipal {
  return { kind: 'guest', tokenHash: createHash('sha256').update(crypto.randomUUID()).digest('hex') }
}

async function createCode(values: Partial<typeof discountCode.$inferInsert> & { code: string }) {
  const [row] = await database.db.insert(discountCode).values({
    name: values.code, kind: 'percent', percentOff: 10, ...values,
  }).returning({ id: discountCode.id })
  return row!.id
}

async function fillCart(principal: CartPrincipal, codeId: string | null) {
  const { cart } = services()
  await cart.setItem(principal, freshVariantId, 2)
  await cart.setItem(principal, processedVariantId, 1)
  if (codeId) await cart.setDiscountCode(principal, codeId)
}

function codInput(quoteToken: string, email = 'contact@example.test') {
  return {
    quoteToken,
    paymentMethod: 'cod' as const,
    contact: { email },
    billingAddress: {
      recipientName: 'Somchai Buyer', addressLine1: '12 Orchard Road', subdistrict: 'Talat Noi',
      district: 'Samphanthawong', province: 'Bangkok', postalCode: '10100', phone: '0812345678',
    },
  }
}

async function placeCod(principal: CartPrincipal, email?: string) {
  const { quote, checkout } = services()
  const quoted = await quote.create(principal, new Date())
  return checkout.placeCod(codInput(quoted.quoteToken, email), principal, `key-${crypto.randomUUID()}`)
}

function stripeGateway(): StripeGateway {
  return {
    checkoutReturnUrls: () => ({ successUrl: 'https://shop.example.test/s', cancelUrl: 'https://shop.example.test/c' }),
    createCheckout: async (input) => ({
      sessionId: `cs_test_${input.orderId}`,
      url: `https://checkout.stripe.com/c/pay/cs_test_${input.orderId}`,
      expiresAt: input.expiresAt,
    }),
    retrieveCheckout: async () => { throw new Error('not used') },
    createFullRefund: async () => { throw new Error('not used') },
    retrieveRefund: async () => { throw new Error('not used') },
    constructEvent: () => { throw new Error('not used') },
  }
}

describe('checkout with discount codes', () => {
  it('freezes a percent discount into the order and its items', async () => {
    const codeId = await createCode({ code: 'TEN', percentOff: 10 })
    const principal = customerPrincipal(customerA)
    await fillCart(principal, codeId)

    const { order } = await placeCod(principal)
    // Subtotal 2 x 1000 + 3000 = 5000; 10% = 500.
    expect(order).toMatchObject({
      subtotalSatang: 5000,
      shippingSatang: shippingFee,
      totalSatang: 5000 - 500 + shippingFee,
      discount: { code: 'TEN', kind: 'percent', itemDiscountSatang: 500, shippingDiscountSatang: 0 },
    })
    const [saved] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, order.id))
    expect(saved).toMatchObject({
      discountCodeId: codeId, discountCode: 'TEN', discountKind: 'percent', discountSatang: 500,
      shippingDiscountSatang: 0, discountEmail: customerA.email, totalSatang: 5000 - 500 + shippingFee,
    })
    const items = await database.db.select().from(orderItem).where(eq(orderItem.orderId, order.id)).orderBy(asc(orderItem.id))
    expect(items.reduce((sum, item) => sum + item.discountSatang, 0)).toBe(500)
    expect(order.items.reduce((sum, item) => sum + (item.discountSatang ?? 0), 0)).toBe(500)
    expect(await database.db.select({ n: sql<number>`count(*)::int` }).from(orderItem).where(eq(orderItem.orderId, order.id)))
      .toEqual([{ n: 2 }])
  })

  it('charges no shipping for a free_shipping code and records the waived fee', async () => {
    const codeId = await createCode({ code: 'SHIP', kind: 'free_shipping', percentOff: null })
    const principal = customerPrincipal(customerA)
    await fillCart(principal, codeId)

    const { order } = await placeCod(principal)
    expect(order).toMatchObject({
      shippingSatang: 0,
      totalSatang: 5000,
      discount: { kind: 'free_shipping', itemDiscountSatang: 0, shippingDiscountSatang: shippingFee },
    })
    const [saved] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, order.id))
    expect(saved).toMatchObject({ shippingSatang: 0, shippingDiscountSatang: shippingFee, discountSatang: 0 })
  })

  it('places a plain order without a code exactly as before', async () => {
    const principal = customerPrincipal(customerA)
    await fillCart(principal, null)
    const { order } = await placeCod(principal)
    expect(order).toMatchObject({ discount: null, totalSatang: 5000 + shippingFee })
  })

  describe('placement rejects a discount that changed since the quote', () => {
    async function quoted(codeId: string, principal: CartPrincipal, email?: string) {
      await fillCart(principal, codeId)
      const quote = await services().quote.create(principal, new Date(), { email })
      expect(quote.discount?.status).toBe('applied')
      return quote
    }

    it('when an admin edit bumps the rule version', async () => {
      const codeId = await createCode({ code: 'EDIT' })
      const principal = customerPrincipal(customerA)
      const quote = await quoted(codeId, principal)
      await database.db.update(discountCode).set({ version: sql`${discountCode.version} + 1` }).where(eq(discountCode.id, codeId))

      await expect(services().checkout.placeCod(codInput(quote.quoteToken), principal, 'key-edit'))
        .rejects.toThrow('QUOTE_STALE')
    })

    it('when the code is paused', async () => {
      const codeId = await createCode({ code: 'PAUSE' })
      const principal = customerPrincipal(customerA)
      const quote = await quoted(codeId, principal)
      await database.db.update(discountCode).set({ active: false }).where(eq(discountCode.id, codeId))

      await expect(services().checkout.placeCod(codInput(quote.quoteToken), principal, 'key-pause'))
        .rejects.toThrow('QUOTE_STALE')
    })

    it('when a guest places with an email that is not on the list', async () => {
      const codeId = await createCode({ code: 'VIP', allowedEmails: ['vip@example.test'] })
      const principal = guestPrincipal()
      const quote = await quoted(codeId, principal, 'VIP@example.test')
      const stripe = new StripeCheckoutService(database.db, commerceSecret, stripeGateway())

      await expect(stripe.place({ ...codInput(quote.quoteToken, 'someone-else@example.test'), paymentMethod: 'stripe' }, principal, 'key-guest-other'))
        .rejects.toThrow('QUOTE_STALE')
    })

    it('when a guest quoted without an email and the code now applies', async () => {
      const codeId = await createCode({ code: 'PUBLIC' })
      const principal = guestPrincipal()
      await fillCart(principal, codeId)
      const quote = await services().quote.create(principal, new Date())
      // No email on a public code: applied already, so this guards the signed amounts, not email.
      expect(quote.discount?.status).toBe('applied')
      await database.db.update(discountCode).set({ percentOff: 20, version: sql`${discountCode.version} + 1` }).where(eq(discountCode.id, codeId))
      const stripe = new StripeCheckoutService(database.db, commerceSecret, stripeGateway())

      await expect(stripe.place({ ...codInput(quote.quoteToken), paymentMethod: 'stripe' }, principal, 'key-guest-stale'))
        .rejects.toThrow('QUOTE_STALE')
    })

    it('when a private-code guest quoted without an email and then supplies an allowed one', async () => {
      const codeId = await createCode({ code: 'PRIV', allowedEmails: ['vip@example.test'] })
      const principal = guestPrincipal()
      await fillCart(principal, codeId)
      const quote = await services().quote.create(principal, new Date())
      expect(quote.discount?.status).toBe('pending_email')
      expect(quote.discountSatang).toBe(0)
      const stripe = new StripeCheckoutService(database.db, commerceSecret, stripeGateway())

      await expect(stripe.place({ ...codInput(quote.quoteToken, 'vip@example.test'), paymentMethod: 'stripe' }, principal, 'key-guest-pending'))
        .rejects.toThrow('QUOTE_STALE')
    })
  })

  it('respects usage_limit across concurrent placements', async () => {
    const codeId = await createCode({ code: 'ONCE', usageLimit: 1 })
    const first = customerPrincipal(customerA)
    const second = customerPrincipal(customerB)
    await fillCart(first, codeId)
    await fillCart(second, codeId)
    const { quote, checkout } = services()
    const quoteA = await quote.create(first, new Date())
    const quoteB = await quote.create(second, new Date())
    expect(quoteA.discount?.status).toBe('applied')
    expect(quoteB.discount?.status).toBe('applied')

    const results = await Promise.allSettled([
      checkout.placeCod(codInput(quoteA.quoteToken), first, 'key-concurrent-a'),
      checkout.placeCod(codInput(quoteB.quoteToken), second, 'key-concurrent-b'),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    expect(String(rejected.reason)).toContain('QUOTE_STALE')
    const orders = await database.db.select().from(commerceOrder).where(eq(commerceOrder.discountCodeId, codeId))
    expect(orders).toHaveLength(1)
  })

  it('frees the usage again when the winning order is cancelled', async () => {
    const codeId = await createCode({ code: 'ONCE', usageLimit: 1 })
    const first = customerPrincipal(customerA)
    const second = customerPrincipal(customerB)
    await fillCart(first, codeId)
    await fillCart(second, codeId)
    const { quote, orders } = services()

    const { order } = await placeCod(first)
    const blocked = await quote.create(second, new Date())
    expect(blocked.discount).toMatchObject({ status: 'not_applicable', reason: 'used_up' })
    expect(blocked.discountSatang).toBe(0)

    await orders.cancel(order.id, { kind: 'customer', userId: first.kind === 'customer' ? first.userId : '' }, 'cancel-winner')
    const fresh = await quote.create(second, new Date())
    expect(fresh.discount).toMatchObject({ status: 'applied' })
    expect(fresh.discountSatang).toBe(500)
  })

  it('enforces the per-customer limit on the normalised account email', async () => {
    const codeId = await createCode({ code: 'ONEEACH', perCustomerLimit: 1 })
    const first = customerPrincipal(customerA)
    await fillCart(first, codeId)
    await placeCod(first)

    // Same address in different case on another account.
    const upper = { id: 'checkout-discount-upper', email: customerA.email.toUpperCase() }
    const now = new Date()
    await database.db.insert(user).values({
      id: upper.id, name: upper.id, email: upper.email, emailVerified: true,
      createdAt: now, updatedAt: now, role: 'customer', accountType: 'customer',
    })
    const second = customerPrincipal(upper)
    await fillCart(second, codeId)
    const quote = await services().quote.create(second, new Date())
    expect(quote.discount).toMatchObject({ status: 'not_applicable', reason: 'already_used' })
    expect(quote.discountSatang).toBe(0)
  })
})
