import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCart } from '@/components/cart/cart-context'
import { reorderQuantities } from '@/lib/reorder'
import type { StoreOrderDetail } from '@/lib/store-orders'

// Adds an order's lines back to the cart, then continues to checkout when every line was accepted.
export function useReorder(order: Pick<StoreOrderDetail, 'items'>) {
  const { cart, setItem, setOpen } = useCart()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  async function reorder() {
    setPending(true)
    setMessage('')
    let skipped = 0
    for (const line of reorderQuantities(order, cart)) {
      try {
        await setItem(line.variantId, line.quantity)
      } catch {
        skipped += 1
      }
    }
    setPending(false)
    if (skipped === order.items.length) {
      setMessage('สินค้าในคำสั่งซื้อนี้ไม่พร้อมขายแล้ว')
      return
    }
    if (skipped) {
      setMessage(`เพิ่มลงตะกร้าแล้ว ยกเว้น ${skipped} รายการที่ไม่พร้อมขาย`)
      setOpen(true)
      return
    }
    navigate('/checkout')
  }

  return { reorder, pending, message, setMessage }
}
