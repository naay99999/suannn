export type OrderPrincipal =
  | { kind: 'customer'; userId: string }
  | { kind: 'guest'; accessToken: string }
  | { kind: 'staff'; userId: string }

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
  status: string
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
  paymentMethod: 'cod'
  createdAt: string
  items: OrderItemSnapshot[]
}

export interface CheckoutResult {
  order: OrderSnapshot
  guestAccessToken?: string
}
