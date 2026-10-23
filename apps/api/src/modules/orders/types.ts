import type { AuditContext } from '../audit/model'
import type { DiscountKind } from '../discounts/types'

export type OrderPrincipal =
  | { kind: 'customer'; userId: string }
  | { kind: 'guest'; accessToken: string }
  | OrderStaffActor

export type OrderStatus = 'pending_payment' | 'placed' | 'processing' | 'packed' | 'shipped' | 'delivered' | 'cancelled'
export type OrderSortField = 'createdAt' | 'orderNumber' | 'recipientName' | 'status' | 'totalSatang'
export type OrderSortDirection = 'asc' | 'desc'
export interface OrderSort {
  field: OrderSortField
  direction: OrderSortDirection
}
export type OrderPaymentStatus = 'awaiting_collection' | 'collected' | 'void'
export type OrderRefundStatus = 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled'

export interface OrderStaffActor {
  kind: 'staff'
  userId: string
  auditContext?: AuditContext
}

export interface CheckoutContact {
  email: string
}

export interface ThaiAddress {
  recipientName: string
  addressLine1: string
  addressLine2?: string | null
  subdistrict: string
  district: string
  province: string
  postalCode: string
}

export type ThaiAddressWithPhone = ThaiAddress & { phone: string }

export type CheckoutAddress = ThaiAddressWithPhone | { addressId: string }

export interface PlaceCodInput {
  quoteToken: string
  paymentMethod: 'cod'
  contact: CheckoutContact
  billingAddress: CheckoutAddress
  shippingAddress?: CheckoutAddress
}

export type StripePaymentMethod = 'card' | 'promptpay'

export interface PlaceStripeInput extends Omit<PlaceCodInput, 'paymentMethod'> {
  paymentMethod: 'stripe'
  stripePaymentMethod?: StripePaymentMethod
}

export type PlaceCheckoutInput = PlaceCodInput | PlaceStripeInput

export interface OrderItemSnapshot {
  id: string
  productId: string
  variantId: string
  sku: string
  productName: string
  variantName: string
  unit: string
  unitPriceSatang: number
  quantity: number
  lineTotalSatang: number
  // Optional so replayed command results stored before discounts existed still validate.
  discountSatang?: number
  // Optional so replayed command results stored before VAT snapshots existed still validate.
  vatTreatment?: 'standard' | 'exempt'
}

export interface OrderBillingSnapshot {
  name: string
  phone: string
  addressLine1: string
  addressLine2: string | null
  subdistrict: string
  district: string
  province: string
  postalCode: string
}

export interface OrderDiscountSnapshot {
  code: string
  kind: DiscountKind
  itemDiscountSatang: number
  shippingDiscountSatang: number
}

export interface OrderSnapshot {
  id: string
  orderNumber: string
  status: OrderStatus
  customerId: string | null
  contactEmail: string
  contactPhone: string
  recipientName: string
  addressLine1: string
  addressLine2: string | null
  subdistrict: string
  district: string
  province: string
  postalCode: string
  // Optional so replayed command results stored before billing snapshots existed still validate.
  billing?: OrderBillingSnapshot
  subtotalSatang: number
  shippingSatang: number
  totalSatang: number
  // Optional so replayed command results stored before discounts existed still validate; null when no code was used.
  discount?: OrderDiscountSnapshot | null
  currency: 'THB'
  paymentMethod: 'cod' | 'stripe'
  createdAt: string
  items: OrderItemSnapshot[]
}

export interface OrderPaymentSnapshot {
  id: string
  method: string
  provider: string
  amountSatang: number
  currency: 'THB'
  status: OrderPaymentStatus
  refund?: {
    id: string
    amountSatang: number
    status: OrderRefundStatus
    createdAt: string
    updatedAt: string
  }
}

export type ShipmentCarrier = 'thailand_post' | 'kerry' | 'flash' | 'jt' | 'other'

export interface ShipmentInput {
  carrier: ShipmentCarrier
  carrierName?: string
  trackingNumber: string
}

export interface OrderShipment {
  carrier: ShipmentCarrier
  carrierName: string | null
  trackingNumber: string
  shippedAt: string
}

export interface OrderReceiptSummary {
  number: string
  kind: 'abbreviated_tax_invoice' | 'receipt'
  status: 'issued' | 'cancelled'
  issuedAt: string
}

export interface OrderDetail extends OrderSnapshot {
  payment: OrderPaymentSnapshot
  // Optional so replayed command results stored before shipments existed still validate.
  shipment?: OrderShipment
  // Optional so replayed command results stored before receipts existed still validate.
  receipt?: OrderReceiptSummary | null
}

export interface StoreOrderDetail extends OrderDetail {
  checkout?: { url: string; expiresAt: string }
}

export interface OrderPage {
  items: OrderDetail[]
  nextCursor: string | null
}

export interface CheckoutResult {
  order: OrderSnapshot
  guestAccessToken?: string
}
