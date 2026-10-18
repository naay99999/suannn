import type { ReactNode } from 'react'
import { Button } from '@workspace/ui/components/button'
import { canResumePayment } from '@/lib/reorder'
import { redirectToStripe, type StoreOrderDetail } from '@/lib/store-orders'
import { ButtonSpinner } from '@/components/loading/button-spinner'
import { formatDeadline } from '@/pages/account/order-display'
import { useReorder } from './use-reorder'

const reorderableStatuses: ReadonlySet<StoreOrderDetail['status']> = new Set(['cancelled', 'delivered'])

// `children` adds the page's own actions (receipt, cancel) to the same row.
export function OrderPaymentActions({ order, guestAccessToken, children }: { order: StoreOrderDetail; guestAccessToken?: string; children?: ReactNode }) {
  const { reorder, pending, message, setMessage } = useReorder(order)

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

  const checkout = canResumePayment(order) ? order.checkout : undefined
  const reorderable = reorderableStatuses.has(order.status)
  if (!checkout && !reorderable && !children) return null
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        {checkout && <Button onClick={resume}>ชำระเงินต่อ</Button>}
        {reorderable && <Button variant={order.status === 'delivered' ? 'default' : 'outline'} disabled={pending} onClick={() => void reorder()}><ButtonSpinner show={pending} />{pending ? 'กำลังเพิ่มลงตะกร้า...' : 'สั่งซื้ออีกครั้ง'}</Button>}
        {children}
      </div>
      {checkout && <p className="text-sm text-muted-foreground">ลิงก์ชำระเงินใช้ได้ถึง {formatDeadline(checkout.expiresAt)} หลังจากนั้นคำสั่งซื้อจะถูกยกเลิกและคืนสต็อก</p>}
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
    </div>
  )
}
