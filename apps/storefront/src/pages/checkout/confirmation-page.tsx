import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { authSessionQuery } from '@/lib/auth-session'
import { formatStorePrice } from '@/lib/store-products'
import { orderQuery } from '@/pages/account/account-queries'

export function Component() {
  const { orderId } = useParams()
  const session = useQuery(authSessionQuery)
  const userId = session.data?.user.accountType === 'customer' ? session.data.user.id : ''
  const order = useQuery({ ...orderQuery(userId, orderId ?? ''), enabled: Boolean(userId && orderId) })

  if (!orderId) return <Empty className="rounded-3xl border bg-card py-20"><EmptyHeader><EmptyTitle>ไม่พบคำสั่งซื้อ</EmptyTitle><EmptyDescription>กลับไปตรวจสอบรายการสินค้าและยืนยันคำสั่งซื้ออีกครั้ง</EmptyDescription></EmptyHeader><EmptyContent><Button render={<Link to="/checkout" />} nativeButton={false}>กลับไป checkout</Button></EmptyContent></Empty>
  if (session.isPending || order.isPending) return <p role="status" className="py-16 text-center text-muted-foreground">กำลังโหลดคำสั่งซื้อ...</p>
  if (!userId) return <Empty className="rounded-3xl border bg-card py-20"><EmptyHeader><EmptyTitle>เข้าสู่ระบบเพื่อดูคำสั่งซื้อ</EmptyTitle><EmptyDescription>คำสั่งซื้อนี้ผูกกับบัญชีลูกค้าที่ใช้ยืนยันรายการ</EmptyDescription></EmptyHeader><EmptyContent><Link className={buttonVariants()} to={`/sign-in?returnTo=${encodeURIComponent(`/checkout/confirmation/${orderId}`)}`}>เข้าสู่ระบบ</Link></EmptyContent></Empty>
  if (order.isError || !order.data) return <div role="alert" className="py-16 text-center"><p>โหลดสถานะคำสั่งซื้อไม่ได้</p><Button variant="outline" className="mt-4" onClick={() => void order.refetch()}>ลองอีกครั้ง</Button></div>

  const snapshot = order.data
  return (
    <div className="mx-auto w-full max-w-3xl">
      <title>{`คำสั่งซื้อ ${snapshot.orderNumber} | suannn`}</title>
      <p className="mb-3 text-sm font-medium text-primary-ink">ยืนยันคำสั่งซื้อแล้ว</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">ขอบคุณที่สั่งซื้อกับเรา</h1>
      <p className="mt-4 text-muted-foreground">หมายเลขคำสั่งซื้อ <strong className="text-foreground">{snapshot.orderNumber}</strong></p>
      <section className="mt-8 rounded-3xl border bg-card p-6 md:p-8" aria-labelledby="confirmation-status-title">
        <h2 id="confirmation-status-title" className="text-xl font-semibold">สถานะคำสั่งซื้อ</h2>
        <p role="status" className="mt-3 text-muted-foreground">{snapshot.paymentMethod === 'cod' ? 'ร้านได้รับคำสั่งซื้อแล้ว ชำระเงินปลายทางเมื่อได้รับสินค้า' : snapshot.status === 'pending_payment' ? 'รอการชำระเงินออนไลน์' : 'สถานะการชำระเงินได้รับการอัปเดตจากร้าน'}</p>
        <ul className="mt-6 divide-y">
          {snapshot.items.map(item => <li key={item.id} className="flex justify-between gap-4 py-3"><span>{item.productName} · {item.variantName} × {item.quantity}</span><span className="shrink-0 tabular-nums">{formatStorePrice(item.lineTotalSatang)}</span></li>)}
        </ul>
        <dl className="mt-4 flex flex-col gap-3 border-t pt-5 text-sm">
          <div className="flex justify-between gap-4"><dt>ยอดรวมสินค้า</dt><dd>{formatStorePrice(snapshot.subtotalSatang)}</dd></div>
          <div className="flex justify-between gap-4"><dt>ค่าจัดส่ง</dt><dd>{formatStorePrice(snapshot.shippingSatang)}</dd></div>
          <div className="flex justify-between gap-4 border-t pt-4 text-base font-semibold"><dt>ยอดคำสั่งซื้อ</dt><dd className="text-primary-ink">{formatStorePrice(snapshot.totalSatang)}</dd></div>
        </dl>
      </section>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link className={buttonVariants()} to={`/account/orders/${snapshot.id}`}>ดูคำสั่งซื้อในบัญชี</Link>
        <Link className={buttonVariants({ variant: 'outline' })} to="/products">เลือกสินค้าต่อ</Link>
      </div>
    </div>
  )
}
