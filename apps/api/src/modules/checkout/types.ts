import type { CartDiscount } from '../discounts/types'

export interface CheckoutQuoteLine {
  variantId: string
  productId: string | null
  productName: string | null
  variantName: string | null
  unit: string | null
  quantity: number
  unitPriceSatang: number
  lineTotalSatang: number
  discountSatang: number
}

export interface CheckoutQuote {
  cartVersion: number
  settingsVersion: number
  currency: 'THB'
  lines: CheckoutQuoteLine[]
  subtotalSatang: number
  discountSatang: number
  shippingDiscountSatang: number
  // Amount charged, after any free-shipping discount.
  shippingSatang: number
  discount: CartDiscount | null
  totalSatang: number
  expiresAt: string
  quoteToken: string
}

export interface SignedCheckoutQuotePayload {
  version: 2
  owner: { kind: 'customer'; id: string } | { kind: 'guest'; id: string }
  cartVersion: number
  settingsVersion: number
  // The full shipping fee; the discount below carries any free-shipping amount.
  shippingSatang: number
  discount: SignedQuoteDiscount | null
  lines: Array<{ variantId: string; quantity: number; unitPriceSatang: number }>
  expiresAt: string
}

export interface SignedQuoteDiscount {
  codeId: string
  codeVersion: number
  itemDiscountSatang: number
  shippingDiscountSatang: number
}
