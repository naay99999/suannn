import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'bun:test'
import type { CartDetail, CartPrincipal } from '../../src/modules/cart/types'
import { QuoteService, decodeSignedCheckoutQuote } from '../../src/modules/checkout/quote'
import type { DiscountService } from '../../src/modules/discounts/service'
import type { DiscountEvaluation, DiscountRule } from '../../src/modules/discounts/types'

const key = new Uint8Array(32).fill(7)
const customer: CartPrincipal = { kind: 'customer', userId: 'customer-1' }
const now = new Date('2026-09-27T10:00:00.000Z')

const cart: CartDetail = {
  cartVersion: 4,
  lines: [{
    variantId: 'variant-a',
    productId: 'product-a',
    productSlug: 'tomatoes',
    productName: 'Tomatoes',
    productImageUrl: null,
    productImageAlt: null,
    variantName: 'Small bag',
    unit: 'bag',
    quantity: 3,
    priceSatang: 1000,
    canPurchase: true,
    issues: [],
    productCategory: 'fresh',
  }],
  discountCodeId: 'rule-1',
}

const rule = { id: 'rule-1', code: 'SAVE', kind: 'fixed', version: 3 } as DiscountRule

function service(evaluation: DiscountEvaluation, emails: Array<string | null> = []) {
  const discounts: Pick<DiscountService, 'quoteDiscount'> = {
    quoteDiscount: async (_principal, _cart, _shipping, email) => {
      emails.push(email)
      return {
        rule,
        evaluation,
        view: evaluation.status === 'applied'
          ? { code: 'SAVE', status: 'applied', reason: null, shortfallSatang: null, itemDiscountSatang: evaluation.itemDiscountSatang, freeShipping: false }
          : { code: 'SAVE', status: 'pending_email', reason: null, shortfallSatang: null, itemDiscountSatang: 0, freeShipping: false },
      }
    },
  }
  return new QuoteService(
    { get: async () => cart } as never,
    { get: async () => ({ id: 1, shippingFeeSatang: 5000, checkoutEnabled: true, version: 8, updatedAt: now }) } as never,
    key,
    discounts,
  )
}

const applied: DiscountEvaluation = {
  status: 'applied',
  itemDiscountSatang: 500,
  shippingDiscountSatang: 0,
  lineDiscounts: [{ variantId: 'variant-a', discountSatang: 500 }],
}

describe('checkout quote discounts', () => {
  it('shows the discount in the totals and signs it into the token', async () => {
    const quote = await service(applied).create(customer, now)

    expect(quote).toMatchObject({
      subtotalSatang: 3000,
      discountSatang: 500,
      shippingDiscountSatang: 0,
      shippingSatang: 5000,
      totalSatang: 7500,
    })
    expect(quote.lines[0]).toMatchObject({ discountSatang: 500 })
    expect(quote.discount).toMatchObject({ code: 'SAVE', status: 'applied' })
    expect(decodeSignedCheckoutQuote(quote.quoteToken, key)?.discount).toEqual({
      codeId: 'rule-1', codeVersion: 3, itemDiscountSatang: 500, shippingDiscountSatang: 0,
    })
  })

  it('charges free shipping and keeps the fee in the signed shipping amount', async () => {
    const quote = await service({ ...applied, itemDiscountSatang: 0, shippingDiscountSatang: 5000, lineDiscounts: [] }).create(customer, now)

    expect(quote).toMatchObject({ discountSatang: 0, shippingDiscountSatang: 5000, shippingSatang: 0, totalSatang: 3000 })
    expect(decodeSignedCheckoutQuote(quote.quoteToken, key)?.shippingSatang).toBe(5000)
  })

  it('signs no discount and charges none when the evaluation is not applied', async () => {
    const quote = await service({ status: 'pending_email' }).create(customer, now)

    expect(quote).toMatchObject({ discountSatang: 0, totalSatang: 8000 })
    expect(quote.discount).toMatchObject({ status: 'pending_email' })
    expect(decodeSignedCheckoutQuote(quote.quoteToken, key)?.discount).toBeNull()
  })

  it('passes the supplied email through and rejects a tampered discount amount', async () => {
    const emails: Array<string | null> = []
    const quotes = service(applied, emails)
    const quote = await quotes.create(customer, now, { email: 'a@example.com' })
    expect(emails).toEqual(['a@example.com'])

    const [payload, signature] = quote.quoteToken.split('.')
    const text = Buffer.from(payload!, 'base64url').toString('utf8').replace('"itemDiscountSatang":500', '"itemDiscountSatang":900')
    const forged = `${Buffer.from(text).toString('base64url')}.${signature}`
    expect(decodeSignedCheckoutQuote(forged, key)).toBeNull()
    await expect(quotes.verify(forged, customer, now)).rejects.toThrow('QUOTE_STALE')
    await expect(quotes.verify(quote.quoteToken, customer, now)).resolves.toMatchObject({ discountSatang: 500 })
  })
})
