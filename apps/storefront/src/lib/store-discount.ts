import { useMutation, useQueryClient } from '@tanstack/react-query'
import { applyCartDiscount, removeCartDiscount, storeCartQueryKey, StoreCartRequestError, type CartDiscount } from './store-cart'
import { formatStorePrice } from './store-products'

type DiscountReason = NonNullable<CartDiscount['reason']>

const reasonText: Record<Exclude<DiscountReason, 'min_subtotal'>, string> = {
  unknown: 'ใช้โค้ดนี้ไม่ได้',
  not_started: 'โค้ดนี้ยังไม่เริ่มใช้',
  expired: 'โค้ดนี้หมดอายุแล้ว',
  used_up: 'โค้ดนี้ถูกใช้ครบแล้ว',
  already_used: 'คุณใช้โค้ดนี้ครบแล้ว',
  min_quantity: 'ยังไม่ถึงจำนวนชิ้นขั้นต่ำของโค้ดนี้',
  no_eligible_items: 'ไม่มีสินค้าในตะกร้าที่ร่วมรายการ',
  first_order_only: 'โค้ดนี้ใช้ได้เฉพาะคำสั่งซื้อแรก',
}

export const discountRateLimitedText = 'ลองใหม่อีกครั้งในภายหลัง'
export const discountPendingEmailText = 'ตรวจสอบสิทธิ์อีกครั้งตอนชำระเงิน'

export function discountReasonText(reason: DiscountReason, shortfallSatang: number | null): string {
  if (reason === 'min_subtotal') {
    return shortfallSatang === null ? reasonText.unknown : `ซื้อเพิ่มอีก ${formatStorePrice(shortfallSatang)} เพื่อใช้โค้ดนี้`
  }
  return reasonText[reason]
}

// What the customer reads under an attached code.
export function discountStatusText(discount: CartDiscount): string {
  if (discount.status === 'pending_email') return discountPendingEmailText
  if (discount.status === 'not_applicable') return discount.reason ? discountReasonText(discount.reason, discount.shortfallSatang) : reasonText.unknown
  return 'ใช้โค้ดแล้ว'
}

// Message for a failed apply request: a 422 carries the reason, a 429 means slow down.
export function discountErrorText(error: unknown): string {
  if (error instanceof StoreCartRequestError) {
    if (error.status === 429) return discountRateLimitedText
    if (error.code === 'DISCOUNT_CODE_REJECTED' && error.reason && error.reason in reasonText) return reasonText[error.reason as keyof typeof reasonText]
  }
  return 'ใช้โค้ดไม่ได้ กรุณาลองอีกครั้ง'
}

export function useApplyDiscount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => applyCartDiscount(code),
    onSuccess: cart => queryClient.setQueryData(storeCartQueryKey, cart),
  })
}

export function useRemoveDiscount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => removeCartDiscount(),
    onSuccess: cart => queryClient.setQueryData(storeCartQueryKey, cart),
  })
}
