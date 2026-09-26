import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'bun:test'
import { loadConfig } from '../../src/config/env'
import type { CartDetail, CartPrincipal } from '../../src/modules/cart/types'
import { QuoteService } from '../../src/modules/checkout/quote'
import type { CommerceSettings } from '../../src/modules/commerce-settings/service'
import { CodPaymentProvider } from '../../src/modules/payments/cod'
import { testEnv } from '../fixtures'

const key = new Uint8Array(32).fill(7)
const customer: CartPrincipal = { kind: 'customer', userId: 'customer-1' }
const guest: CartPrincipal = { kind: 'guest', tokenHash: 'a'.repeat(64) }

function sampleCart(): CartDetail {
  return {
    cartVersion: 4,
    lines: [
      {
        variantId: 'variant-a',
        productId: 'product-a',
        productSlug: 'tomatoes',
        productName: 'Tomatoes',
        productImageUrl: null,
        productImageAlt: null,
        variantName: 'Small bag',
        unit: 'bag',
        quantity: 3,
        priceSatang: 999,
        canPurchase: true,
        issues: [],
      },
    ],
  }
}

function settings(overrides: Partial<CommerceSettings> = {}): CommerceSettings {
  return {
    id: 1,
    shippingFeeSatang: 1001,
    checkoutEnabled: true,
    version: 8,
    updatedAt: new Date('2026-09-27T00:00:00.000Z'),
    ...overrides,
  }
}

function quoteService() {
  let cart = sampleCart()
  let commerceSettings = settings()
  const service = new QuoteService(
    { get: async () => cart } as never,
    { get: async () => commerceSettings } as never,
    key,
  )
  return {
    service,
    setCart: (value: CartDetail) => { cart = value },
    setSettings: (value: CommerceSettings) => { commerceSettings = value },
  }
}

describe('checkout quote signing', () => {
  it('binds the signed quote to its owner for a 15-minute lifetime', async () => {
    const { service } = quoteService()
    const now = new Date('2026-09-27T10:00:00.000Z')
    const created = await service.create(customer, now)

    expect(created.expiresAt).toBe('2026-09-27T10:15:00.000Z')
    await expect(service.verify(created.quoteToken, customer, new Date(now.getTime() + 14 * 60_000 + 59_999)))
      .resolves.toMatchObject({ totalSatang: 3998 })
    await expect(service.verify(created.quoteToken, guest, new Date(now.getTime() + 1_000)))
      .rejects.toThrow('QUOTE_STALE')
    await expect(service.verify(created.quoteToken, customer, new Date(now.getTime() + 15 * 60_000)))
      .rejects.toThrow('QUOTE_STALE')
  })

  it('rejects token tampering', async () => {
    const { service } = quoteService()
    const created = await service.create(customer, new Date('2026-09-27T10:00:00.000Z'))
    const tampered = `${created.quoteToken.slice(0, -1)}${created.quoteToken.endsWith('A') ? 'B' : 'A'}`

    await expect(service.verify(tampered, customer, new Date('2026-09-27T10:01:00.000Z')))
      .rejects.toThrow('QUOTE_STALE')
  })

  it('does not disclose the guest cart ownership hash in the signed quote token', async () => {
    const { service } = quoteService()
    const created = await service.create(guest, new Date('2026-09-27T10:00:00.000Z'))
    const payload = Buffer.from(created.quoteToken.split('.')[0]!, 'base64url').toString('utf8')

    expect(payload).not.toContain(guest.tokenHash)
    await expect(service.verify(created.quoteToken, guest, new Date('2026-09-27T10:01:00.000Z')))
      .resolves.toMatchObject({ cartVersion: 4 })
  })

  it('marks the quote stale when cart version, live price, or settings version changes', async () => {
    const { service, setCart, setSettings } = quoteService()
    const now = new Date('2026-09-27T10:00:00.000Z')

    const cartQuote = await service.create(customer, now)
    setCart({ ...sampleCart(), cartVersion: 5 })
    await expect(service.verify(cartQuote.quoteToken, customer, now)).rejects.toThrow('QUOTE_STALE')

    setCart(sampleCart())
    const priceQuote = await service.create(customer, now)
    setCart({ ...sampleCart(), lines: [{ ...sampleCart().lines[0]!, priceSatang: 1000 }] })
    await expect(service.verify(priceQuote.quoteToken, customer, now)).rejects.toThrow('QUOTE_STALE')

    setCart(sampleCart())
    const settingsQuote = await service.create(customer, now)
    setSettings(settings({ version: 9 }))
    await expect(service.verify(settingsQuote.quoteToken, customer, now)).rejects.toThrow('QUOTE_STALE')
  })

  it('computes integer satang totals from live cart lines and server settings', async () => {
    const { service } = quoteService()
    const quote = await service.create(customer, new Date('2026-09-27T10:00:00.000Z'))

    expect(quote).toMatchObject({ subtotalSatang: 2997, shippingSatang: 1001, totalSatang: 3998 })
    expect(quote.lines[0]).toMatchObject({ quantity: 3, unitPriceSatang: 999, lineTotalSatang: 2997 })
  })

  it('rejects checkout unless enabled and the shipping fee is configured', async () => {
    const { service, setSettings } = quoteService()
    const now = new Date('2026-09-27T10:00:00.000Z')

    setSettings(settings({ checkoutEnabled: false }))
    await expect(service.create(customer, now)).rejects.toThrow('CHECKOUT_DISABLED')
    setSettings(settings({ shippingFeeSatang: null }))
    await expect(service.create(customer, now)).rejects.toThrow('SHIPPING_FEE_UNSET')
  })

  it('loads COMMERCE_SECRET as a base64url key of at least 32 bytes', () => {
    expect(loadConfig(testEnv).commerceSecret).toEqual(new Uint8Array(32))
    expect(() => loadConfig({ ...testEnv, COMMERCE_SECRET: 'AQ' })).toThrow('COMMERCE_SECRET')
  })
})

describe('COD payment provider', () => {
  it('starts payment in awaiting_collection without making a gateway request', () => {
    const provider = new CodPaymentProvider()

    expect(provider.method).toBe('cod')
    expect(provider.initialPayment(3998)).toEqual({
      method: 'cod',
      provider: 'cod',
      amountSatang: 3998,
      status: 'awaiting_collection',
    })
  })
})
