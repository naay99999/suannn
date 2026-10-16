import type { StoreCartDetail } from '@/lib/store-cart'
import type { StoreOrderDetail } from '@/lib/store-orders'

const maximumLineQuantity = 99

// Adds each ordered quantity on top of what is already in the cart.
export function reorderQuantities(order: Pick<StoreOrderDetail, 'items'>, cart: Pick<StoreCartDetail, 'lines'> | undefined) {
  const current = new Map(cart?.lines.map(line => [line.variantId, line.quantity]) ?? [])
  const totals = new Map<string, number>()
  for (const item of order.items) totals.set(item.variantId, (totals.get(item.variantId) ?? current.get(item.variantId) ?? 0) + item.quantity)
  return [...totals].map(([variantId, quantity]) => ({ variantId, quantity: Math.min(quantity, maximumLineQuantity) }))
}

export function canResumePayment(order: Pick<StoreOrderDetail, 'status' | 'checkout'>, now = Date.now()): boolean {
  return order.status === 'pending_payment' && Boolean(order.checkout) && Date.parse(order.checkout!.expiresAt) > now
}
