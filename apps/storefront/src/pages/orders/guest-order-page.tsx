import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { formatStorePrice } from '@/lib/store-products'
import {
  forgetGuestOrderToken,
  downloadGuestReceipt,
  getGuestOrder,
  guestOrderQueryKey,
  guestOrderTokenFromHash,
  readGuestOrderToken,
  refundStatusLabel,
  saveGuestOrderToken,
  StoreOrderRequestError,
} from '@/lib/store-orders'
import { orderStatusLabels } from '@/pages/account/order-display'
import { ShipmentDetails } from '@/components/orders/shipment-details'
import { BillingReceiptCard } from '@/components/orders/billing-receipt-card'
import { OrderPaymentActions } from '@/components/orders/order-payment-actions'
import { PageLoading } from '@/components/loading/page-loading'
import { ButtonSpinner } from '@/components/loading/button-spinner'

export function Component() {
  const { orderId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  // An emailed link carries the token in the fragment; otherwise reuse this tab's checkout or earlier lookup.
  const [initialToken] = useState(() => guestOrderTokenFromHash(location.hash) || readGuestOrderToken(orderId))
  const [tokenInput, setTokenInput] = useState('')
  const [request, setRequest] = useState({ token: initialToken, attempt: initialToken ? 1 : 0 })
  const [missingToken, setMissingToken] = useState(false)
  const order = useQuery({
    queryKey: guestOrderQueryKey(orderId, request.attempt),
    queryFn: () => getGuestOrder(orderId, request.token),
    enabled: Boolean(orderId && request.token),
    retry: false,
  })

  useEffect(() => {
    if (location.hash) navigate({ pathname: location.pathname, search: location.search }, { replace: true })
  }, [location.hash, location.pathname, location.search, navigate])

  useEffect(() => {
    if (order.isSuccess) saveGuestOrderToken(orderId, request.token)
    else if (order.error instanceof StoreOrderRequestError && [401, 404].includes(order.error.status)) forgetGuestOrderToken(orderId)
  }, [order.isSuccess, order.error, orderId, request.token])

  if (!orderId) return <Empty className="rounded-3xl border bg-card py-20"><EmptyHeader><EmptyTitle>ไม่พบหมายเลขคำสั่งซื้อ</EmptyTitle><EmptyDescription>เปิดลิงก์ดูคำสั่งซื้อจากอีเมลยืนยันอีกครั้ง</EmptyDescription></EmptyHeader><EmptyContent><Link className={buttonVariants()} to="/products">กลับไปที่ร้าน</Link></EmptyContent></Empty>

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Read the submitted value so a browser-autofilled token is used even if React state never saw it.
    const submitted = new FormData(event.currentTarget).get('token')
    const token = (typeof submitted === 'string' ? submitted : tokenInput).trim()
    setMissingToken(!token)
    if (!token) return
    setTokenInput(token)
    setRequest(previous => ({ token, attempt: previous.attempt + 1 }))
  }

  const detail = order.data
  const needsToken = !request.token || order.isError
  return (
    <div className="mx-auto w-full max-w-3xl">
      <title>ติดตามคำสั่งซื้อ | suannn</title>
      <p className="mb-3 text-sm font-medium text-primary-ink">สั่งซื้อโดยไม่สมัครสมาชิก</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">ตรวจสอบคำสั่งซื้อ</h1>
      {needsToken && <>
        <p className="mt-4 leading-7 text-muted-foreground">กดปุ่มดูคำสั่งซื้อในอีเมลยืนยันคำสั่งซื้อ หรือกรอกรหัสเข้าดูจากอีเมลนั้น</p>
        <form onSubmit={submit} className="mt-8 rounded-3xl border bg-card p-5 md:p-8">
          <Field data-invalid={missingToken}>
            <FieldLabel htmlFor="guest-order-token">รหัสเข้าดูคำสั่งซื้อ</FieldLabel>
            <Input id="guest-order-token" name="token" type="password" autoComplete="new-password" data-1p-ignore data-lpignore="true" spellCheck={false} value={tokenInput} onChange={event => { setTokenInput(event.target.value); setMissingToken(false) }} aria-invalid={missingToken} aria-describedby={missingToken ? 'guest-token-help guest-token-error' : 'guest-token-help'} />
            <p id="guest-token-help" className="text-xs text-muted-foreground">รหัสนี้ใช้ได้เฉพาะคำสั่งซื้อนี้ อย่าส่งต่อให้ผู้อื่น</p>
            {missingToken && <FieldError id="guest-token-error">กรอกรหัสเข้าดูคำสั่งซื้อจากอีเมลยืนยันคำสั่งซื้อ</FieldError>}
          </Field>
          {order.isError && <p role="alert" className="mt-4 text-sm text-destructive">ไม่พบคำสั่งซื้อหรือรหัสไม่ถูกต้อง ตรวจรหัสในอีเมลแล้วลองอีกครั้ง</p>}
          <Button className="mt-5" type="submit" disabled={order.isFetching}><ButtonSpinner show={order.isFetching} />{order.isFetching ? 'กำลังตรวจสอบ...' : 'ดูคำสั่งซื้อ'}</Button>
        </form>
      </>}
      {!needsToken && order.isPending && <PageLoading label="กำลังโหลดคำสั่งซื้อ..." className="mt-8 justify-start py-0" />}
      {detail && <section className="mt-8 rounded-3xl border bg-card p-6 md:p-8" aria-labelledby="guest-order-title">
        <h2 id="guest-order-title" className="text-xl font-semibold">คำสั่งซื้อ {detail.orderNumber}</h2>
        <p role="status" className="mt-3 text-sm text-muted-foreground">สถานะ: {orderStatusLabels[detail.status]}{detail.status === 'pending_payment' ? ' · รอการชำระเงินออนไลน์' : detail.payment.status === 'collected' ? ' · ชำระเงินแล้ว' : ''}</p>
        <ul className="mt-5 divide-y">{detail.items.map(item => <li key={item.id} className="flex justify-between gap-4 py-3"><span>{item.productName} · {item.variantName} × {item.quantity}</span><span className="shrink-0 tabular-nums">{formatStorePrice(item.lineTotalSatang)}</span></li>)}</ul>
        <dl className="mt-4 flex flex-col gap-3 border-t pt-4 text-sm">
          <div className="flex justify-between gap-4"><dt>ยอดรวมสินค้า</dt><dd>{formatStorePrice(detail.subtotalSatang)}</dd></div>
          <div className="flex justify-between gap-4"><dt>ค่าจัดส่ง</dt><dd>{formatStorePrice(detail.shippingSatang)}</dd></div>
          <div className="flex justify-between gap-4 border-t pt-4 text-base font-semibold"><dt>ยอดรวม</dt><dd>{formatStorePrice(detail.totalSatang)}</dd></div>
        </dl>
        <div className="mt-5 empty:hidden"><OrderPaymentActions order={detail} guestAccessToken={request.token} /></div>
        <div className="mt-4 empty:hidden"><BillingReceiptCard billing={detail.billing} receipt={detail.receipt} download={fileName => downloadGuestReceipt(orderId, request.token, fetch, fileName)} /></div>
        {detail.shipment && <div className="mt-4 border-t pt-4"><ShipmentDetails shipment={detail.shipment} /></div>}
        {detail.payment.refund && <p className="mt-4 text-sm text-muted-foreground">การคืนเงิน: {refundStatusLabel(detail.payment.refund)} · {formatStorePrice(detail.payment.refund.amountSatang)}</p>}
      </section>}
    </div>
  )
}
