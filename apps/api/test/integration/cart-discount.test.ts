import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  auditLog,
  cart,
  discountCode,
  inventoryLot,
  product,
  productVariant,
  user,
} from '../../src/database/schema'
import { CartRepository } from '../../src/modules/cart/repository'
import { CartService } from '../../src/modules/cart/service'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { DiscountRepository } from '../../src/modules/discounts/repository'
import { DiscountService } from '../../src/modules/discounts/service'
import { MediaUrls } from '../../src/modules/media/urls'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const customerId = 'cart-discount-customer'
const customerEmail = 'Buyer@Example.test'
let unlockDatabase: (() => Promise<void>) | undefined
let productId: string
let variantId: string

const cartService = new CartService(new CartRepository(
  database.db,
  { getSellableVariantIds: async (ids: readonly string[]) => new Set(ids) },
  new MediaUrls('https://media.example.test'),
))
const discounts = new DiscountService(
  new DiscountRepository(database.db, new AuditService(new AuditRepository(database.db))),
  { get: async () => ({ shippingFeeSatang: 5000 }) } as never,
)

const customer = { kind: 'customer', userId: customerId } as const
const guest = { kind: 'guest', tokenHash: 'cart-discount-guest-1' } as const

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values({
    id: customerId, name: 'Buyer', email: customerEmail, emailVerified: true, createdAt: now, updatedAt: now,
    role: 'customer', accountType: 'customer',
  })
})

beforeEach(async () => {
  await database.db.delete(auditLog)
  await database.db.delete(cart)
  await database.db.delete(discountCode)
  await database.db.delete(inventoryLot)
  await database.db.delete(productVariant)
  await database.db.delete(product)

  const now = new Date()
  productId = crypto.randomUUID()
  variantId = crypto.randomUUID()
  await database.db.insert(product).values({
    id: productId, slug: `cart-discount-${crypto.randomUUID()}`, name: 'Mango', category: 'fresh',
    vatTreatment: 'exempt', status: 'published', createdAt: now, updatedAt: now, publishedAt: now,
  })
  await database.db.insert(productVariant).values({
    id: variantId, productId, sku: `CD-${crypto.randomUUID()}`, name: 'Box', unit: 'box', priceSatang: 10_000,
    salesEnabled: true, displayOrder: 0, minRemainingShelfLifeDays: 0, createdAt: now, updatedAt: now,
  })
})

afterAll(async () => {
  await database.db.delete(cart)
  await database.db.delete(discountCode)
  await database.db.delete(productVariant)
  await database.db.delete(product)
  await database.db.delete(user).where(eq(user.id, customerId))
  await unlockDatabase?.()
  await database.client.end()
})

async function createCode(values: Partial<typeof discountCode.$inferInsert> & { code: string }) {
  const [row] = await database.db.insert(discountCode).values({
    name: values.code, kind: 'percent', percentOff: 10, ...values,
  }).returning({ id: discountCode.id })
  return row!.id
}

// Mirrors the route: resolve, attach, then describe.
async function apply(principal: typeof customer | typeof guest, code: string) {
  const current = await cartService.get(principal)
  const result = await discounts.resolveForApply(principal, current, code)
  if (!result.ok) return result
  const updated = await cartService.setDiscountCode(principal, result.ruleId)
  return { ok: true as const, discount: await discounts.describeForCart(principal, updated), cart: updated }
}

describe('cart discount codes', () => {
  it('applies a percent code and shows itemDiscountSatang on later reads', async () => {
    await createCode({ code: 'SAVE10' })
    await cartService.setItem(customer, variantId, 3)
    const result = await apply(customer, ' save10 ')
    expect(result).toMatchObject({ ok: true, discount: { code: 'SAVE10', status: 'applied', itemDiscountSatang: 3000 } })

    const read = await cartService.get(customer)
    expect(await discounts.describeForCart(customer, read)).toMatchObject({
      status: 'applied', reason: null, shortfallSatang: null, itemDiscountSatang: 3000, freeShipping: false,
    })
  })

  it('attaches a code below its minimum subtotal as not_applicable with the shortfall', async () => {
    await createCode({ code: 'BIG', minSubtotalSatang: 50_000 })
    await cartService.setItem(customer, variantId, 3)
    const result = await apply(customer, 'BIG')
    expect(result).toMatchObject({
      ok: true,
      discount: { status: 'not_applicable', reason: 'min_subtotal', shortfallSatang: 20_000, itemDiscountSatang: 0 },
    })
  })

  it('shows free_shipping codes with freeShipping true', async () => {
    await createCode({ code: 'SHIPFREE', kind: 'free_shipping', percentOff: null })
    await cartService.setItem(customer, variantId, 1)
    expect(await apply(customer, 'SHIPFREE')).toMatchObject({
      ok: true, discount: { status: 'applied', freeShipping: true, itemDiscountSatang: 0 },
    })
  })

  it('answers pending_email for a guest applying a private code', async () => {
    await createCode({ code: 'VIP', allowedEmails: ['buyer@example.test'] })
    await cartService.setItem(guest, variantId, 1)
    expect(await apply(guest, 'VIP')).toMatchObject({ ok: true, discount: { status: 'pending_email' } })
  })

  it('shows a private code as applied for a customer whose account email is on the list', async () => {
    await createCode({ code: 'VIP', allowedEmails: ['buyer@example.test'] })
    await cartService.setItem(customer, variantId, 1)
    expect(await apply(customer, 'VIP')).toMatchObject({ ok: true, discount: { status: 'applied' } })
  })

  it('rejects a private code for a customer whose email is not on the list', async () => {
    await createCode({ code: 'VIP', allowedEmails: ['someone-else@example.test'] })
    await cartService.setItem(customer, variantId, 1)
    expect(await apply(customer, 'VIP')).toEqual({ ok: false, reason: 'unknown' })
    expect((await cartService.get(customer)).discountCodeId).toBeNull()
  })

  it('rejects unknown, paused and expired codes without attaching', async () => {
    await createCode({ code: 'PAUSED', active: false })
    await createCode({ code: 'OLD', endsAt: new Date(Date.now() - 1000) })
    await cartService.setItem(customer, variantId, 1)
    expect(await apply(customer, 'NOPE')).toEqual({ ok: false, reason: 'unknown' })
    expect(await apply(customer, 'PAUSED')).toEqual({ ok: false, reason: 'unknown' })
    expect(await apply(customer, 'OLD')).toEqual({ ok: false, reason: 'expired' })
    expect((await cartService.get(customer)).discountCodeId).toBeNull()
  })

  it('removes the code and bumps the cart version', async () => {
    await createCode({ code: 'SAVE10' })
    const before = await cartService.setItem(customer, variantId, 1)
    const attached = await cartService.setDiscountCode(customer, (await createCodeId('SAVE10')))
    expect(attached.cartVersion).toBe(before.cartVersion + 1)
    const removed = await cartService.setDiscountCode(customer, null)
    expect(removed.discountCodeId).toBeNull()
    expect(removed.cartVersion).toBe(attached.cartVersion + 1)
    expect(await discounts.describeForCart(customer, removed)).toBeNull()
  })

  it('moves a guest code to an empty customer cart on merge', async () => {
    await createCode({ code: 'SAVE10' })
    await cartService.setItem(guest, variantId, 1)
    await apply(guest, 'SAVE10')
    const merged = await cartService.mergeGuest(customerId, guest.tokenHash)
    expect(await discounts.describeForCart(customer, merged.cart)).toMatchObject({ code: 'SAVE10', status: 'applied' })
  })

  it('keeps the customer code when both carts hold one', async () => {
    await createCode({ code: 'GUESTCODE' })
    await createCode({ code: 'OWNCODE', percentOff: 20 })
    await cartService.setItem(customer, variantId, 1)
    await apply(customer, 'OWNCODE')
    await cartService.setItem(guest, variantId, 1)
    await apply(guest, 'GUESTCODE')
    const merged = await cartService.mergeGuest(customerId, guest.tokenHash)
    expect(await discounts.describeForCart(customer, merged.cart)).toMatchObject({ code: 'OWNCODE' })
  })

  it('shows not_applicable unknown when the code is paused after being applied', async () => {
    const id = await createCode({ code: 'SAVE10' })
    await cartService.setItem(customer, variantId, 1)
    await apply(customer, 'SAVE10')
    await database.db.update(discountCode).set({ active: false }).where(eq(discountCode.id, id))
    expect(await discounts.describeForCart(customer, await cartService.get(customer))).toMatchObject({
      code: 'SAVE10', status: 'not_applicable', reason: 'unknown', itemDiscountSatang: 0,
    })
  })

  it('drops a deleted code from the cart view', async () => {
    const id = await createCode({ code: 'SAVE10' })
    await cartService.setItem(customer, variantId, 1)
    await apply(customer, 'SAVE10')
    await database.db.delete(discountCode).where(eq(discountCode.id, id))
    const read = await cartService.get(customer)
    expect(read.discountCodeId).toBeNull()
    expect(await discounts.describeForCart(customer, read)).toBeNull()
  })
})

async function createCodeId(code: string) {
  const [row] = await database.db.select({ id: discountCode.id }).from(discountCode).where(eq(discountCode.code, code))
  return row!.id
}
