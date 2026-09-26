import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from '../helpers/database'

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

async function insertCustomer() {
  const id = `commerce-customer-${crypto.randomUUID()}`
  const email = `${id}@example.com`

  await database.client.unsafe(`
    insert into "user" (id, name, email, email_verified, created_at, updated_at, role, account_type)
    values ($1, 'Commerce test customer', $2, false, now(), now(), 'customer', 'customer')
  `, [id, email])

  return id
}

async function insertCart(input: {
  customerId?: string | null
  guestTokenHash?: string | null
}) {
  const id = crypto.randomUUID()
  const expiresAt = input.guestTokenHash
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    : null

  await database.client.unsafe(`
    insert into cart (id, customer_id, guest_token_hash, expires_at)
    values ($1, $2, $3, $4)
  `, [id, input.customerId ?? null, input.guestTokenHash ?? null, expiresAt])

  return id
}

async function insertVariant() {
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()

  await database.client.unsafe(`
    insert into product (id, slug, name, category)
    values ($1, $2, 'Commerce test product', 'fresh')
  `, [productId, `commerce-test-${productId}`])
  await database.client.unsafe(`
    insert into product_variant (id, product_id, sku, name, unit, price_satang)
    values ($1, $2, $3, 'Test variant', 'unit', 100)
  `, [variantId, productId, `COMMERCE-TEST-${variantId}`])

  return variantId
}

async function insertCartItem(cartId: string, variantId: string, quantity: number) {
  await database.client.unsafe(`
    insert into cart_item (cart_id, variant_id, quantity)
    values ($1, $2, $3)
  `, [cartId, variantId, quantity])
}

describe('cart and commerce settings schema migration', () => {
  it('seeds one disabled settings row with no shipping fee and version one', async () => {
    const rows = await database.client.unsafe<{
      id: number
      shipping_fee_satang: number | null
      checkout_enabled: boolean
      version: number
    }[]>(`
      select id, shipping_fee_satang, checkout_enabled, version
      from commerce_settings
    `)

    expect([...rows]).toEqual([{
      id: 1,
      shipping_fee_satang: null,
      checkout_enabled: false,
      version: 1,
    }])
  })

  it('requires exactly one cart owner and prevents duplicate owner carts', async () => {
    const customerId = await insertCustomer()

    await expect(insertCart({})).rejects.toMatchObject({ code: '23514' })
    await expect(insertCart({ customerId, guestTokenHash: 'guest-hash-both' }))
      .rejects.toMatchObject({ code: '23514' })

    await insertCart({ customerId })
    await expect(insertCart({ customerId })).rejects.toMatchObject({ code: '23505' })

    await insertCart({ guestTokenHash: 'guest-hash-unique' })
    await expect(insertCart({ guestTokenHash: 'guest-hash-unique' }))
      .rejects.toMatchObject({ code: '23505' })
  })

  it('keeps cart quantities between one and ninety-nine and one line per variant', async () => {
    const cartId = await insertCart({ guestTokenHash: 'quantity-test-guest-hash' })
    const variantId = await insertVariant()

    await insertCartItem(cartId, variantId, 1)
    await insertCartItem(cartId, await insertVariant(), 99)
    await expect(insertCartItem(cartId, await insertVariant(), 0))
      .rejects.toMatchObject({ code: '23514' })
    await expect(insertCartItem(cartId, await insertVariant(), 100))
      .rejects.toMatchObject({ code: '23514' })
    await expect(insertCartItem(cartId, variantId, 2))
      .rejects.toMatchObject({ code: '23505' })
  })

  it('keeps checkout disabled until a nonnegative shipping fee is configured', async () => {
    await expect((async () => {
      await database.client.unsafe(`
        update commerce_settings
        set checkout_enabled = true
        where id = 1
      `)
    })()).rejects.toMatchObject({ code: '23514' })

    await expect((async () => {
      await database.client.unsafe(`
        update commerce_settings
        set shipping_fee_satang = -1
        where id = 1
      `)
    })()).rejects.toMatchObject({ code: '23514' })

    await expect((async () => {
      await database.client.unsafe(`
        insert into commerce_settings (id, shipping_fee_satang, checkout_enabled, version)
        values (2, 0, false, 1)
      `)
    })()).rejects.toMatchObject({ code: '23514' })
  })
})
