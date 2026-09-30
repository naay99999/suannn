import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Field, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { formatStorePrice } from '@/lib/store-products'
import { getGuestOrder, guestOrderQueryKey, readPendingCheckout } from '@/lib/store-orders'

export function Component() {
  const { orderId = '' } = useParams()
  const pending = readPendingCheckout()
  const initialToken = pending?.orderId === orderId ? pending.guestAccessToken ?? '' : ''
  const [tokenInput, setTokenInput] = useState(initialToken)
  const [request, setRequest] = useState({ token: initialToken, attempt: initialToken ? 1 : 0 })
  const order = useQuery({
    queryKey: guestOrderQueryKey(orderId, request.attempt),
    queryFn: () => getGuestOrder(orderId, request.token),
    enabled: Boolean(orderId && request.token),
    retry: false,
  })

  if (!orderId) return <Empty className="rounded-3xl border bg-card py-20"><EmptyHeader><EmptyTitle>ไม่พบหมายเลขคำสั่งซื้อ</EmptyTitle><EmptyDescription>เปิดลิงก์ guest order จากอีเมลอีกครั้ง</EmptyDescription></EmptyHeader><EmptyContent><Link className={buttonVariants()} to="/products">กลับไปที่ร้าน</Link></EmptyContent></Empty>

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRequest(previous => ({ token: tokenInput.trim(), attempt: previous.attempt + 1 }))
  }

  const detail = order.data
  return (
    <div className="mx-auto w-full max-w-3xl">
      <title>คำสั่งซื้อ guest | suannn</title>
      <p className="mb-3 text-sm font-medium text-primary-ink">คำสั่งซื้อ guest</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">ตรวจสอบคำสั่งซื้อ</h1>
      <p className="mt-4 leading-7 text-muted-foreground">กรอก guest access token จากอีเมลยืนยัน ระบบจะส่ง token ผ่าน header ไปตรวจสอบคำสั่งซื้อโดยไม่ใส่ token ในลิงก์</p>
      <form onSubmit={submit} className="mt-8 rounded-3xl border bg-card p-5 md:p-8">
        <Field>
          <FieldLabel htmlFor="guest-order-token">Guest access token</FieldLabel>
          <Input id="guest-order-token" type="password" autoComplete="off" spellCheck={false} value={tokenInput} onChange={event => setTokenInput(event.target.value)} aria-describedby="guest-token-help" />
          <p id="guest-token-help" className="text-xs text-muted-foreground">Token จะไม่ถูกบันทึกใน URL หรือ localStorage</p>
        </Field>
        <Button className="mt-5" type="submit" disabled={!tokenInput.trim() || order.isFetching}>{order.isFetching ? 'กำลังตรวจสอบ...' : 'ดูคำสั่งซื้อ'}</Button>
      </form>
      {order.isError && <p role="alert" className="mt-5 text-sm text-destructive">ไม่พบคำสั่งซื้อหรือ token ใช้ไม่ได้ ตรวจ token ในอีเมลแล้วลองอีกครั้ง</p>}
      {order.isPending && request.token && <p role="status" className="mt-5 text-sm text-muted-foreground">กำลังโหลดคำสั่งซื้อ...</p>}
      {detail && <section className="mt-8 rounded-3xl border bg-card p-6 md:p-8" aria-labelledby="guest-order-title">
        <h2 id="guest-order-title" className="text-xl font-semibold">คำสั่งซื้อ {detail.orderNumber}</h2>
        <p role="status" className="mt-3 text-sm text-muted-foreground">{detail.status === 'pending_payment' ? 'รอการชำระเงินออนไลน์' : detail.payment.status === 'collected' ? 'ได้รับการยืนยันการชำระเงินจากระบบแล้ว' : 'สถานะคำสั่งซื้อได้รับการอัปเดตจากร้าน'}</p>
        <ul className="mt-5 divide-y">{detail.items.map(item => <li key={item.id} className="flex justify-between gap-4 py-3"><span>{item.productName} · {item.variantName} × {item.quantity}</span><span className="shrink-0 tabular-nums">{formatStorePrice(item.lineTotalSatang)}</span></li>)}</ul>
        <dl className="mt-4 flex flex-col gap-3 border-t pt-4 text-sm">
          <div className="flex justify-between gap-4"><dt>ยอดรวมสินค้า</dt><dd>{formatStorePrice(detail.subtotalSatang)}</dd></div>
          <div className="flex justify-between gap-4"><dt>ค่าจัดส่ง</dt><dd>{formatStorePrice(detail.shippingSatang)}</dd></div>
          <div className="flex justify-between gap-4 border-t pt-4 text-base font-semibold"><dt>ยอดรวม</dt><dd>{formatStorePrice(detail.totalSatang)}</dd></div>
        </dl>
      </section>}
    </div>
  )
}
