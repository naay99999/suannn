import type { AuditContext } from '../audit/model'

export type OrderPrincipal =
  | { kind: 'customer'; userId: string }
  | { kind: 'guest'; accessToken: string }
  | OrderStaffActor

export type OrderStatus = 'pending_payment' | 'placed' | 'processing' | 'packed' | 'shipped' | 'delivered' | 'cancelled'
export type OrderPaymentStatus = 'awaiting_collection' | 'collected' | 'void'
export type OrderRefundStatus = 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled'

export interface OrderStaffActor {
  kind: 'staff'
  userId: string
  auditContext?: AuditContext
}

export interface CheckoutContact {
  email: string
  phone: string
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

export type CheckoutAddress = ThaiAddress | { addressId: string }

export interface PlaceCodInput {
  quoteToken: string
  paymentMethod: 'cod'
  contact: CheckoutContact
  address: CheckoutAddress
}

export interface PlaceStripeInput extends Omit<PlaceCodInput, 'paymentMethod'> {
  paymentMethod: 'stripe'
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
  subtotalSatang: number
  shippingSatang: number
  totalSatang: number
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

export interface OrderDetail extends OrderSnapshot {
  payment: OrderPaymentSnapshot
}

export interface OrderPage {
  items: OrderDetail[]
  nextCursor: string | null
}

export interface CheckoutResult {
  order: OrderSnapshot
  guestAccessToken?: string
}
