import { QueryClient } from '@tanstack/react-query'
import { createElement } from 'react'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CheckoutQuoteSummary } from '../src/pages/checkout/order-summary'
import { availablePaymentMethods, buildCheckoutOrderBody, checkoutQuoteQueryKey, refreshAfterStaleQuote, type CheckoutQuote } from '../src/lib/store-checkout'

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
    expect(html).toContain('฿25.00')
    expect(html).toContain('฿35.00')
    expect(html).toContain('฿60.00')
  })

  test('saved delivery address is submitted by addressId', () => {
    expect(buildCheckoutOrderBody(quote, 'cod', { email: 'shopper@example.com', phone: '0812345678' }, { addressId: 'address-1' }).address)
      .toEqual({ addressId: 'address-1' })
  })

  test('guest checkout offers Stripe only', () => {
    expect(availablePaymentMethods(false)).toEqual(['stripe'])
    expect(availablePaymentMethods(true)).toEqual(['cod', 'stripe'])
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
