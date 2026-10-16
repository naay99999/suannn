import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { useCart } from '@/components/cart/cart-context'
import { canResumePayment, reorderQuantities } from '@/lib/reorder'
import { redirectToStripe, type StoreOrderDetail } from '@/lib/store-orders'

export function OrderPaymentActions({ order, guestAccessToken }: { order: StoreOrderDetail; guestAccessToken?: string }) {
  const { cart, setItem, setOpen } = useCart()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  function resume() {
    if (!order.checkout) return
    try {
      redirectToStripe({
        orderId: order.id,
        paymentMethod: 'stripe',
        expiresAt: order.checkout.expiresAt,
        ...(guestAccessToken ? { guestAccessToken } : {}),
      }, order.checkout.url)
    } catch {
      setMessage('เปิดหน้าชำระเงินไม่ได้ กรุณาสั่งซื้อใหม่')
    }
  }

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

  const resumable = canResumePayment(order)
  if (!resumable && order.status !== 'cancelled') return null
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {resumable && <Button onClick={resume}>ชำระเงินต่อ</Button>}
        {order.status === 'cancelled' && <Button variant="outline" disabled={pending} onClick={() => void reorder()}>{pending ? 'กำลังเพิ่มลงตะกร้า...' : 'สั่งซื้ออีกครั้ง'}</Button>}
      </div>
      {resumable && <p className="text-sm text-muted-foreground">ลิงก์ชำระเงินใช้ได้ถึง {new Date(order.checkout!.expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น. หลังจากนั้นคำสั่งซื้อจะถูกยกเลิกและคืนสต็อก</p>}
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
    </div>
  )
}
