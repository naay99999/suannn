import type { OrderBillingSnapshot } from '../orders/types'
import type { ReceiptSeller } from './settings'

export type VatTreatment = 'standard' | 'exempt'
export type ReceiptKind = 'abbreviated_tax_invoice' | 'receipt'
export type ReceiptStatus = 'issued' | 'cancelled'

export interface ReceiptTotals {
  exemptSatang: number
  vatableSatang: number
  vatSatang: number
  preVatSatang: number
  totalSatang: number
  vatRateBasisPoints: number
}

export interface ReceiptLine {
  productName: string
  variantName: string
  unit: string
  quantity: number
  unitPriceSatang: number
  lineTotalSatang: number
  vatTreatment: VatTreatment
}

// The only source for receipt documents after issuance. Never rebuilt from live data.
export interface ReceiptSnapshot {
  version: 1
  kind: ReceiptKind
  receiptNumber: string
  issuedAt: string
  paidAt: string | null
  seller: ReceiptSeller
  billing: OrderBillingSnapshot
  orderNumber: string
  paymentMethod: 'cod' | 'stripe'
  lines: ReceiptLine[]
  shippingSatang: number
  totals: ReceiptTotals
}

export type ReceiptIssueActor = { type: 'system' } | { type: 'staff'; userId: string }
export type ReceiptIssueResult = 'issued' | 'exists' | 'not_eligible' | 'deferred'
