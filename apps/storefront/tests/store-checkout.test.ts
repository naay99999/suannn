import { QueryClient } from '@tanstack/react-query'
import { createElement } from 'react'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CheckoutQuoteSummary } from '../src/pages/checkout/order-summary'
import { availablePaymentMethods, buildCheckoutOrderBody, effectivePaymentMethod, checkoutQuoteQueryKey, refreshAfterStaleQuote, type CheckoutQuote } from '../src/lib/store-checkout'

const quote: CheckoutQuote = {
  cartVersion: 5,
  settingsVersion: 2,
  currency: 'THB',
  lines: [{ variantId: 'variant-1', productId: 'product-1', productName: 'มะม่วง', variantName: '1 กก.', unit: 'กก.', quantity: 2, unitPriceSatang: 1250, lineTotalSatang: 2500 }],
  subtotalSatang: 2500,
  shippingSatang: 3500,
  totalSatang: 6000,
  expiresAt: '2026-09-30T12:00:00.000Z',
  quoteToken: 'signed-quote-token',
}

describe('store checkout API', () => {
  test('quote summary renders API shipping and total amounts', () => {
    const html = renderToStaticMarkup(createElement(CheckoutQuoteSummary, { quote }))
    expect(html).toContain('฿25')
    expect(html).toContain('฿35')
    expect(html).toContain('฿60')
    expect(html).not.toContain('฿60.00')
    expect(html).toContain('฿12.50 / กก. · จำนวน 2')
  })

  test('long orders preview three items with a show-more button for the rest', () => {
    const lines = Array.from({ length: 5 }, (_, index) => ({ ...quote.lines[0]!, variantId: `variant-${index}`, productName: `สินค้า ${index}` }))
    const html = renderToStaticMarkup(createElement(CheckoutQuoteSummary, { quote: { ...quote, lines } }))
    expect(html).toContain('สินค้า 2')
    expect(html).not.toContain('สินค้า 3')
    expect(html).toContain('ดูเพิ่มเติม (อีก 2 รายการ)')
    expect(renderToStaticMarkup(createElement(CheckoutQuoteSummary, { quote }))).not.toContain('ดูเพิ่มเติม')
  })

  test('saved delivery address is submitted by addressId', () => {
    expect(buildCheckoutOrderBody(quote, 'cod', { email: 'shopper@example.com', phone: '0812345678' }, { addressId: 'address-1' }).address)
      .toEqual({ addressId: 'address-1' })
  })

  test('guest checkout offers card and PromptPay only', () => {
    expect(availablePaymentMethods(false)).toEqual(['card', 'promptpay'])
    expect(availablePaymentMethods(true)).toEqual(['cod', 'card', 'promptpay'])
  })

  test('card and PromptPay choices are sent as Stripe orders with the chosen method', () => {
    const contact = { email: 'shopper@example.com', phone: '0812345678' }
    const address = { addressId: 'address-1' }
    expect(buildCheckoutOrderBody(quote, 'cod', contact, address)).not.toHaveProperty('stripePaymentMethod')
    expect(buildCheckoutOrderBody(quote, 'card', contact, address)).toMatchObject({ paymentMethod: 'stripe', stripePaymentMethod: 'card' })
    expect(buildCheckoutOrderBody(quote, 'promptpay', contact, address)).toMatchObject({ paymentMethod: 'stripe', stripePaymentMethod: 'promptpay' })
  })

  test('a guest who had COD selected falls back to card', () => {
    expect(effectivePaymentMethod(false, 'cod')).toBe('card')
    expect(effectivePaymentMethod(false, 'promptpay')).toBe('promptpay')
    expect(effectivePaymentMethod(true, 'cod')).toBe('cod')
  })

  test('stale quote invalidates cart and quote state for a fresh quote', async () => {
    const queryClient = new QueryClient()
    const quoteKey = checkoutQuoteQueryKey(5)
    queryClient.setQueryData(['store-cart'], { cartVersion: 5, lines: [] })
    queryClient.setQueryData(quoteKey, quote)

    await refreshAfterStaleQuote(queryClient, quoteKey)

    expect(queryClient.getQueryState(['store-cart'])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(quoteKey)?.isInvalidated).toBe(true)
  })
})
