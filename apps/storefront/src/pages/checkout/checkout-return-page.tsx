import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { authSessionQuery } from '@/lib/auth-session'
import { formatStorePrice } from '@/lib/store-products'
import { checkoutReturnMessage, missingCheckoutContextMessage, type ReturnMode } from '@/lib/checkout-return'
import { getCustomerOrder, getGuestOrder, guestOrderQueryKey, readPendingCheckout, storeOrderQueryKey, type PendingCheckout } from '@/lib/store-orders'

export function Component() {
  const location = useLocation()
  const navigate = useNavigate()
  const session = useQuery(authSessionQuery)
  const [pending] = useState<PendingCheckout | null>(() => readPendingCheckout())
  const mode: ReturnMode = location.pathname.endsWith('/cancel') ? 'cancel' : 'success'

  useEffect(() => {
    if (location.search) navigate(location.pathname, { replace: true })
  }, [location.pathname, location.search, navigate])

  const order = useQuery({
    queryKey: pending?.guestAccessToken
      ? guestOrderQueryKey(pending.orderId)
      : storeOrderQueryKey(pending?.orderId ?? ''),
    queryFn: () => pending?.guestAccessToken
      ? getGuestOrder(pending.orderId, pending.guestAccessToken)
      : getCustomerOrder(pending!.orderId),
    enabled: Boolean(pending && pending.paymentMethod === 'stripe'),
    retry: false,
    refetchInterval: query => query.state.data?.status === 'pending_payment' && query.state.dataUpdateCount < 10 ? 2000 : false,
    refetchIntervalInBackground: false,
  })

  if (!pending || pending.paymentMethod !== 'stripe') {
    const isCustomer = session.data?.user.accountType === 'customer'
    return <Empty className="rounded-3xl border bg-card py-20"><EmptyHeader><EmptyTitle>{mode === 'cancel' ? 'กลับจากหน้าชำระเงิน' : 'ตรวจสอบคำสั่งซื้อไม่สำเร็จ'}</EmptyTitle><EmptyDescription>{missingCheckoutContextMessage(isCustomer ? 'customer' : 'guest')}</EmptyDescription></EmptyHeader><EmptyContent>{isCustomer ? <Link className={buttonVariants()} to="/account/orders">ดูคำสั่งซื้อของฉัน</Link> : <Link className={buttonVariants()} to="/products">กลับไปที่ร้าน</Link>}</EmptyContent></Empty>
  }

  if (order.isPending) return <p role="status" className="py-16 text-center text-muted-foreground">กำลังตรวจสอบสถานะการชำระเงิน...</p>
  if (order.isError || !order.data) return <div className="mx-auto max-w-2xl py-12 text-center"><h1 className="text-3xl font-semibold">ตรวจสอบสถานะคำสั่งซื้อไม่ได้</h1><p className="mt-3 text-muted-foreground">คำสั่งซื้อยังไม่ถูกยกเลิกจากการกลับมาหน้านี้ ลองโหลดสถานะอีกครั้ง</p><Button className="mt-6" variant="outline" onClick={() => void order.refetch()}>ลองอีกครั้ง</Button></div>

  const snapshot = order.data
  const settled = snapshot.status !== 'pending_payment'
  const returnMessage = checkoutReturnMessage(mode, {
    paymentMethod: snapshot.paymentMethod,
    status: snapshot.status,
    paymentStatus: snapshot.payment.status,
  })

  return (
    <div className="mx-auto w-full max-w-3xl">
      <title>{mode === 'cancel' ? 'กลับจากชำระเงิน' : 'สถานะการชำระเงิน'} | suannn</title>
      <p className="mb-3 text-sm font-medium text-primary-ink">คำสั่งซื้อ {snapshot.orderNumber}</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{mode === 'cancel' ? 'กลับจากหน้าชำระเงิน' : 'ตรวจสอบผลการชำระเงิน'}</h1>
      <p role="status" className="mt-5 text-base leading-7 text-muted-foreground">{returnMessage}</p>
      <section className="mt-8 rounded-3xl border bg-card p-6 md:p-8" aria-labelledby="return-order-title">
        <h2 id="return-order-title" className="text-xl font-semibold">สรุปคำสั่งซื้อ</h2>
        <ul className="mt-5 divide-y">{snapshot.items.map(item => <li key={item.id} className="flex justify-between gap-4 py-3"><span>{item.productName} · {item.variantName} × {item.quantity}</span><span className="shrink-0 tabular-nums">{formatStorePrice(item.lineTotalSatang)}</span></li>)}</ul>
        <dl className="mt-4 border-t pt-4"><div className="flex justify-between gap-4 font-semibold"><dt>ยอดคำสั่งซื้อ</dt><dd>{formatStorePrice(snapshot.totalSatang)}</dd></div></dl>
      </section>
      <div className="mt-6 flex flex-wrap gap-3">
        {pending.guestAccessToken
          ? <Link className={buttonVariants()} to={`/orders/guest/${snapshot.id}`}>เปิดคำสั่งซื้อ guest</Link>
          : <Link className={buttonVariants()} to={`/account/orders/${snapshot.id}`}>ดูคำสั่งซื้อในบัญชี</Link>}
        {!settled && <Button variant="outline" onClick={() => void order.refetch()}>ตรวจสอบอีกครั้ง</Button>}
      </div>
    </div>
  )
}
