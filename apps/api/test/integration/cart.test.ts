import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  auditLog,
  cart,
  cartItem,
  inventoryLot,
  product,
  productVariant,
  user,
} from '../../src/database/schema'
import { CartRepository } from '../../src/modules/cart/repository'
import { CartService } from '../../src/modules/cart/service'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const customerId = 'cart-customer'
let unlockDatabase: (() => Promise<void>) | undefined
let catalogProductId: string
let variantIds: string[]

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values({
    id: customerId,
    name: 'Cart Customer',
    email: 'cart-customer@example.test',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    role: 'customer',
    accountType: 'customer',
  })
})

beforeEach(async () => {
  await database.db.delete(auditLog)
  await database.db.delete(cart)
  await database.db.delete(inventoryLot)
  await database.db.delete(productVariant)
  await database.db.delete(product)

  const now = new Date()
  catalogProductId = crypto.randomUUID()
  variantIds = Array.from({ length: 51 }, () => crypto.randomUUID())
  await database.db.insert(product).values({
    id: catalogProductId,
    slug: `cart-${crypto.randomUUID()}`,
    name: 'Cart tomato',
    category: 'fresh',
    status: 'published',
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  })
  await database.db.insert(productVariant).values(variantIds.map((id, index) => ({
    id,
    productId: catalogProductId,
    sku: `CART-${crypto.randomUUID()}`,
    name: `Variant ${index + 1}`,
    unit: 'bag',
    priceSatang: 4500 + index,
    salesEnabled: true,
    displayOrder: index,
    minRemainingShelfLifeDays: 0,
    createdAt: now,
    updatedAt: now,
  })))
})

afterAll(async () => {
  await database.db.delete(cart)
  await database.db.delete(inventoryLot)
  await database.db.delete(productVariant)
  await database.db.delete(product)
  await database.db.delete(user).where(eq(user.id, customerId))
  await unlockDatabase?.()
  await database.client.end()
})

function createCartService() {
  const inventory = new InventoryReadRepository(database.db)
  return new CartService(new CartRepository(database.db, inventory))
}

const customer = { kind: 'customer', userId: customerId } as const
const guest = { kind: 'guest', tokenHash: 'guest-token-hash-1' } as const

describe('persistent cart ownership and edits', () => {
  it('keeps customer and guest carts isolated', async () => {
    const service = createCartService()
    await service.setItem(customer, variantIds[0]!, 2)
    await service.setItem(guest, variantIds[0]!, 5)

    expect((await service.get(customer)).lines.map(({ quantity }) => quantity)).toEqual([2])
    expect((await service.get(guest)).lines.map(({ quantity }) => quantity)).toEqual([5])
    expect(await database.db.select().from(cart)).toHaveLength(2)
  })

  it('allows at most 50 distinct lines per cart', async () => {
    const service = createCartService()
    for (const variantId of variantIds.slice(0, 50)) await service.setItem(customer, variantId!, 1)

    await expect(service.setItem(customer, variantIds[50]!, 1)).rejects.toThrow('CART_LINE_LIMIT_REACHED')
    expect((await service.get(customer)).lines).toHaveLength(50)
  })

  it('limits a line to 99 units and treats PUT as an absolute quantity', async () => {
    const service = createCartService()
    const first = await service.setItem(customer, variantIds[0]!, 7)
    const replay = await service.setItem(customer, variantIds[0]!, 7)

    expect(first.lines[0]?.quantity).toBe(7)
    expect(first.cartVersion).toBe(2)
    expect(replay.lines[0]?.quantity).toBe(7)
    expect(replay.cartVersion).toBe(2)
    await service.setItem(customer, variantIds[0]!, 99)
    await expect(service.setItem(customer, variantIds[0]!, 100)).rejects.toThrow('CART_QUANTITY_LIMIT_REACHED')
    expect((await service.get(customer)).lines[0]?.quantity).toBe(99)

    await service.setItem(guest, variantIds[1]!, 3)
    const [beforeReplay] = await database.db.select().from(cart)
      .where(eq(cart.guestTokenHash, guest.tokenHash))
    await service.setItem(guest, variantIds[1]!, 3)
    const [afterReplay] = await database.db.select().from(cart)
      .where(eq(cart.guestTokenHash, guest.tokenHash))
    expect(afterReplay?.version).toBe(beforeReplay?.version)
    expect(afterReplay?.lastMutationAt).toEqual(beforeReplay?.lastMutationAt)
    expect(afterReplay?.expiresAt).toEqual(beforeReplay?.expiresAt)
  })

  it('removes a line and treats a repeated DELETE as an empty-cart result', async () => {
    const service = createCartService()
    await service.setItem(customer, variantIds[0]!, 7)

    const removed = await service.removeItem(customer, variantIds[0]!)
    const replay = await service.removeItem(customer, variantIds[0]!)
    expect(removed.lines).toEqual([])
    expect(replay.lines).toEqual([])
    expect(replay.cartVersion).toBe(3)
  })

  it('rejects missing, archived, or unpublished variants when adding a line', async () => {
    const service = createCartService()
    const archivedVariantId = variantIds[0]!
    await database.db.update(productVariant).set({ archivedAt: new Date() })
      .where(eq(productVariant.id, archivedVariantId))
    await expect(service.setItem(customer, crypto.randomUUID(), 1))
      .rejects.toThrow('CART_VARIANT_UNAVAILABLE')
    await expect(service.setItem(customer, archivedVariantId, 1))
      .rejects.toThrow('CART_VARIANT_UNAVAILABLE')

    await database.db.update(product).set({ status: 'archived', archivedAt: new Date() })
      .where(eq(product.id, catalogProductId))
    await expect(service.setItem(customer, variantIds[1]!, 1))
      .rejects.toThrow('CART_VARIANT_UNAVAILABLE')
    expect(await database.db.select().from(cartItem)).toHaveLength(0)
  })

  it('keeps an active but out-of-stock line visible with an issue and no stock promise', async () => {
    const service = createCartService()
    await service.setItem(customer, variantIds[0]!, 3)

    const detail = await service.get(customer)
    expect(detail.lines).toHaveLength(1)
    expect(detail.lines[0]).toMatchObject({
      variantId: variantIds[0],
      quantity: 3,
      priceSatang: 4500,
      canPurchase: false,
      issues: ['OUT_OF_STOCK'],
      productName: 'Cart tomato',
      variantName: 'Variant 1',
    })
    expect(detail.lines[0]).not.toHaveProperty('stock')
  })

  it('sets a guest cart expiry 30 days after its last mutation', async () => {
    const service = createCartService()
    await service.setItem(guest, variantIds[0]!, 1)
    const [storedCart] = await database.db.select().from(cart)
      .where(eq(cart.guestTokenHash, guest.tokenHash))

    expect(storedCart?.expiresAt).not.toBeNull()
    expect(storedCart?.lastMutationAt).toBeInstanceOf(Date)
    expect(storedCart!.expiresAt!.getTime() - storedCart!.lastMutationAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000)

    await database.db.update(cart).set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(cart.guestTokenHash, guest.tokenHash))
    expect(await service.get(guest)).toEqual({ cartVersion: 0, lines: [] })
    const renewed = await service.setItem(guest, variantIds[1]!, 2)
    expect(renewed.lines).toHaveLength(1)
    expect(renewed.lines[0]?.variantId).toBe(variantIds[1])
  })

  it('merges duplicate lines once, skips an archived guest line, and consumes the guest cart', async () => {
    const service = createCartService()
    const sharedVariantId = variantIds[0]!
    const cappedVariantId = variantIds[2]!
    const archivedVariantId = variantIds[1]!
    await service.setItem(customer, sharedVariantId, 4)
    await service.setItem(customer, cappedVariantId, 90)
    await service.setItem(guest, sharedVariantId, 3)
    await service.setItem(guest, cappedVariantId, 20)
    await service.setItem(guest, archivedVariantId, 2)
    await database.db.update(productVariant).set({ archivedAt: new Date() })
      .where(eq(productVariant.id, archivedVariantId))

    const firstMerge = await service.mergeGuest(customerId, guest.tokenHash)
    const replay = await service.mergeGuest(customerId, guest.tokenHash)
    const sharedLine = firstMerge.cart.lines.find(({ variantId }) => variantId === sharedVariantId)
    const cappedLine = firstMerge.cart.lines.find(({ variantId }) => variantId === cappedVariantId)

    expect(sharedLine?.quantity).toBe(7)
    expect(cappedLine?.quantity).toBe(99)
    expect(firstMerge.skipped).toEqual([{ variantId: archivedVariantId, code: 'VARIANT_UNAVAILABLE' }])
    expect(replay.cart.lines.find(({ variantId }) => variantId === sharedVariantId)?.quantity).toBe(7)
    expect(replay.cart.lines.find(({ variantId }) => variantId === cappedVariantId)?.quantity).toBe(99)
    expect(await database.db.select().from(cart).where(eq(cart.guestTokenHash, guest.tokenHash))).toHaveLength(0)
    expect(await database.db.select().from(cartItem)
      .where(eq(cartItem.variantId, archivedVariantId))).toHaveLength(0)
  })
})
