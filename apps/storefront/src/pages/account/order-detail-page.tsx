import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { buttonVariants } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { authSessionQuery } from '@/lib/auth-session'
import { orderQuery } from './account-queries'
import { AccountQueryFeedback } from './account-query-feedback'
import { AccountPageHeading, AddressText, OrderItems, OrderStatus } from './account-ui'
import { formatOrderDate, formatSatang } from './order-display'
import { classifyAccountError } from './account-state'

export function Component() {
  const { orderId = '' } = useParams()
  const session = useQuery(authSessionQuery).data
  const userId = session?.user.id ?? ''
  const order = useQuery({ ...orderQuery(userId, orderId), enabled: Boolean(userId && orderId) })

  if (order.isPending) return <p role="status" className="py-12 text-muted-foreground">กำลังโหลดคำสั่งซื้อ...</p>
  if (order.isError && classifyAccountError(order.error) === 'not-found') return (
    <><title>ไม่พบคำสั่งซื้อ | suannn</title><Empty className="rounded-3xl border bg-card py-16"><EmptyHeader><EmptyTitle>ไม่พบรายการนี้</EmptyTitle><EmptyDescription>ตรวจสอบหมายเลขคำสั่งซื้อหรือกลับไปดูรายการทั้งหมด</EmptyDescription></EmptyHeader><EmptyContent><Link to="/account/orders" className={buttonVariants({ size: 'storefront' })}>กลับไปคำสั่งซื้อ</Link></EmptyContent></Empty></>
  )
  if (order.isError) return <AccountQueryFeedback error={order.error} retry={() => void order.refetch()} />
  const detail = order.data

  return (
    <>
      <title>{detail.orderNumber} | คำสั่งซื้อ | suannn</title>
      <Link to="/account/orders" className="mb-5 inline-flex text-sm font-medium text-primary-ink underline underline-offset-4">กลับไปคำสั่งซื้อทั้งหมด</Link>
      <AccountPageHeading title={detail.orderNumber} description={`สั่งซื้อเมื่อ ${formatOrderDate(detail.createdAt)}`} action={<OrderStatus status={detail.status} />} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        <Card><CardHeader><CardTitle className="text-lg">สินค้าในคำสั่งซื้อ</CardTitle></CardHeader><CardContent className="gap-6"><OrderItems order={detail} /><dl className="flex flex-col gap-3 border-t pt-5 text-sm"><div className="flex justify-between gap-4"><dt>ยอดรวมสินค้า</dt><dd>{formatSatang(detail.subtotalSatang)}</dd></div><div className="flex justify-between gap-4"><dt>ค่าจัดส่ง</dt><dd>{formatSatang(detail.shippingSatang)}</dd></div><div className="flex justify-between gap-4 border-t pt-4 font-semibold"><dt>ยอดรวมทั้งหมด</dt><dd className="tabular-nums text-primary-ink">{formatSatang(detail.totalSatang)}</dd></div></dl></CardContent></Card>
        <div className="flex flex-col gap-6">
          <Card><CardHeader><CardTitle className="text-lg">จัดส่งถึง</CardTitle></CardHeader><CardContent className="leading-7"><p className="font-medium">{detail.recipientName}</p><p className="text-muted-foreground">{detail.contactPhone}</p><p className="text-muted-foreground"><AddressText address={detail} /></p></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-lg">การชำระเงิน</CardTitle></CardHeader><CardContent><p>{detail.paymentMethod === 'cod' ? 'เก็บเงินปลายทาง' : 'ชำระผ่าน Stripe'}</p><p className="mt-2 text-sm text-muted-foreground">สถานะ: {detail.payment.status === 'collected' ? detail.paymentMethod === 'stripe' ? 'Stripe ยืนยันการชำระเงินแล้ว' : 'รับเงินปลายทางแล้ว' : detail.payment.status === 'awaiting_collection' ? detail.paymentMethod === 'stripe' ? 'รอผลการชำระเงินจาก Stripe' : 'รอรับเงินปลายทาง' : 'ยกเลิกการชำระเงิน'}</p></CardContent></Card>
        </div>
      </div>
    </>
  )
}
