export type DiscountKind = 'percent' | 'fixed' | 'free_shipping'

export type DiscountReason =
  | 'unknown'
  | 'not_started'
  | 'expired'
  | 'used_up'
  | 'already_used'
  | 'min_subtotal'
  | 'min_quantity'
  | 'no_eligible_items'
  | 'first_order_only'

export interface DiscountRule {
  id: string
  code: string
  kind: DiscountKind
  version: number
  active: boolean
  percentOff: number | null
  amountOffSatang: number | null
  maxDiscountSatang: number | null
  minSubtotalSatang: number | null
  minQuantity: number | null
  eligibleCategories: Array<'fresh' | 'processed'>
  eligibleProductIds: string[]
  startsAt: Date | null
  endsAt: Date | null
  usageLimit: number | null
  perCustomerLimit: number | null
  allowedEmails: string[]
  firstOrderOnly: boolean
}

export interface DiscountLineInput {
  variantId: string
  productId: string | null
  category: 'fresh' | 'processed' | null
  quantity: number
  lineTotalSatang: number
}

export interface DiscountUsage {
  total: number
  byEmail: number
  hasPriorOrder: boolean
}

export type DiscountEvaluation =
  | {
      status: 'applied'
      itemDiscountSatang: number
      shippingDiscountSatang: number
      lineDiscounts: Array<{ variantId: string; discountSatang: number }>
    }
  | { status: 'pending_email' }
  | { status: 'rejected'; reason: DiscountReason; shortfallSatang: number | null }
