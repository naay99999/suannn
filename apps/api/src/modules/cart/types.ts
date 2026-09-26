export type CartPrincipal =
  | { kind: 'customer'; userId: string }
  | { kind: 'guest'; tokenHash: string }

export type CartIssueCode = 'PRODUCT_UNAVAILABLE' | 'VARIANT_UNAVAILABLE' | 'OUT_OF_STOCK'

export interface CartLine {
  variantId: string
  productId: string | null
  productSlug: string | null
  productName: string | null
  productImageUrl: string | null
  productImageAlt: string | null
  variantName: string | null
  unit: string | null
  quantity: number
  priceSatang: number | null
  canPurchase: boolean
  issues: CartIssueCode[]
}

export interface CartDetail {
  cartVersion: number
  lines: CartLine[]
}

export type MergeSkippedCode = CartIssueCode | 'CART_LINE_LIMIT_REACHED'

export interface MergeSkippedLine {
  variantId: string
  code: MergeSkippedCode
}
