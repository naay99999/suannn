export interface CheckoutQuoteLine {
  variantId: string
  productId: string | null
  productName: string | null
  variantName: string | null
  unit: string | null
  quantity: number
  unitPriceSatang: number
  lineTotalSatang: number
}

export interface CheckoutQuote {
  cartVersion: number
  settingsVersion: number
  currency: 'THB'
  lines: CheckoutQuoteLine[]
  subtotalSatang: number
  shippingSatang: number
  totalSatang: number
  expiresAt: string
  quoteToken: string
}

export interface SignedCheckoutQuotePayload {
  version: 1
  owner: { kind: 'customer'; id: string } | { kind: 'guest'; id: string }
  cartVersion: number
  settingsVersion: number
  shippingSatang: number
  lines: Array<{ variantId: string; quantity: number; unitPriceSatang: number }>
  expiresAt: string
}
