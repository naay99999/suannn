import type { StoreCartDetail } from '@/lib/store-cart'

export interface CheckoutDetails {
  name: string
  email: string
  phone: string
  addressLine1: string
  addressLine2: string
  subdistrict: string
  district: string
  province: string
  postalCode: string
}

export interface ConfirmationState {
  details: CheckoutDetails
  cart: StoreCartDetail
}
