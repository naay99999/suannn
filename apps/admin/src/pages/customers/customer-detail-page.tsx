import { Link, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft01Icon, ArrowRight01Icon, Mail01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { CopyButton, CopyRow } from '@/components/copy-button'
import { QueryState } from '@/components/query-state'
import { customerIdPattern, type CustomerDetail } from '@/lib/customers/api'
import { customerQuery } from '@/lib/customers/queries'
import { formatDateOnly, formatMoney, formatTimestamp } from '@/lib/format'
import { orderStatusLabels } from '@/lib/orders/labels'

type Address = CustomerDetail['addresses'][number]

function addressText(address: Address) {
  return [address.addressLine1, address.addressLine2, address.subdistrict, address.district, address.province, address.postalCode].filter(Boolean).join(' ')
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-1 rounded-surface border bg-card px-4 py-3"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-xl font-semibold tracking-tight tabular-nums">{value}</dd></div>
}

function BackButton() {
  const navigate = useNavigate()
  // Return to wherever staff came from (usually an order); fall back to the list on a direct visit.
  const canGoBack = typeof window !== 'undefined' && (window.history.state as { idx?: number } | null)?.idx !== undefined && (window.history.state as { idx: number }).idx > 0
  return <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" onClick={() => void (canGoBack ? navigate(-1) : navigate('/customers'))}><HugeiconsIcon data-icon="inline-start" icon={ArrowLeft01Icon} strokeWidth={2} />ย้อนกลับ</Button>
}

export function Component() {
  const { customerId = '' } = useParams()
  const valid = customerIdPattern.test(customerId)
  const customer = useQuery({ ...customerQuery(customerId), enabled: valid })
  if (!valid) return <section className="px-4 lg:px-6"><QueryState kind="not-found" message="รหัสลูกค้าไม่ถูกต้อง" /></section>
  if (customer.isPending) return <section className="px-4 lg:px-6"><QueryState kind="loading" /></section>
  if (customer.isError || !customer.data) return <section className="px-4 lg:px-6"><QueryState kind={customer.error && 'status' in customer.error && customer.error.status === 404 ? 'not-found' : 'error'} message="โหลดข้อมูลลูกค้าไม่ได้" onRetry={() => void customer.refetch()} /></section>
  const data = customer.data

  return <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 lg:px-6">
    <header className="flex flex-col gap-5">
      <BackButton />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">ลูกค้า</p>
        <h1 className="text-3xl font-semibold tracking-tight">{data.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <a className="flex items-center gap-1.5 underline-offset-4 hover:text-foreground hover:underline" href={`mailto:${data.email}`}><HugeiconsIcon icon={Mail01Icon} strokeWidth={2} className="size-3.5" />{data.email}</a>
          <CopyButton value={data.email} label="คัดลอกอีเมล" copiedMessage="คัดลอกอีเมลแล้ว" />
          <Badge variant={data.emailVerified ? 'success' : 'warning'}>{data.emailVerified ? 'ยืนยันอีเมลแล้ว' : 'ยังไม่ยืนยันอีเมล'}</Badge>
          {data.banned && <Badge variant="destructive">ระงับบัญชี</Badge>}
          <span>สมัครเมื่อ {formatDateOnly(data.createdAt)}</span>
        </div>
      </div>
    </header>

    <dl className="grid gap-3 sm:grid-cols-3">
      <Stat label="คำสั่งซื้อทั้งหมด" value={data.stats.orderCount.toLocaleString('th-TH')} />
      <Stat label="ยอดซื้อสะสม" value={formatMoney(data.stats.spentSatang)} />
      <Stat label="สั่งซื้อล่าสุด" value={data.stats.lastOrderAt ? formatDateOnly(data.stats.lastOrderAt) : '—'} />
    </dl>

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <CardTitle>คำสั่งซื้อล่าสุด</CardTitle>
          <CardDescription>แสดงสูงสุด 10 รายการ ยอดซื้อสะสมไม่นับคำสั่งซื้อที่รอชำระหรือถูกยกเลิก</CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentOrders.length === 0
            ? <Empty className="min-h-40 border-0"><EmptyHeader><EmptyTitle>ยังไม่มีคำสั่งซื้อ</EmptyTitle><EmptyDescription>คำสั่งซื้อของลูกค้ารายนี้จะแสดงที่นี่</EmptyDescription></EmptyHeader></Empty>
            : <ul className="-mx-2 flex flex-col">{data.recentOrders.map(order => <li key={order.id}>
              <Link to={`/orders/${order.id}`} className="group/order flex items-center justify-between gap-4 rounded-field px-2 py-3 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">{order.orderNumber}</span>
                  <span className="text-xs text-muted-foreground">{formatTimestamp(order.createdAt)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <Badge variant={orderStatusLabels[order.status].tone}>{orderStatusLabels[order.status].label}</Badge>
                  <span className="w-24 text-right font-medium tabular-nums">{formatMoney(order.totalSatang)}</span>
                  <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-4 text-muted-foreground transition-transform group-hover/order:translate-x-0.5" />
                </span>
              </Link>
            </li>)}</ul>}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <h2 className="text-base font-medium">ที่อยู่ที่บันทึกไว้</h2>
        {data.addresses.length === 0
          ? <p className="text-sm text-muted-foreground">ลูกค้ายังไม่ได้บันทึกที่อยู่</p>
          : data.addresses.map(address => <Card key={address.id} size="sm">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">{address.label}{address.isDefaultShipping && <Badge variant="info">จัดส่งหลัก</Badge>}{address.isDefaultBilling && <Badge variant="outline">ใบเสร็จหลัก</Badge>}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              <CopyRow value={address.recipientName} label={`คัดลอกชื่อผู้รับ ${address.label}`} copiedMessage="คัดลอกชื่อผู้รับแล้ว"><p className="font-medium">{address.recipientName}</p></CopyRow>
              <CopyRow value={address.phone} label={`คัดลอกเบอร์โทร ${address.label}`} copiedMessage="คัดลอกเบอร์โทรแล้ว"><p className="text-muted-foreground tabular-nums">{address.phone}</p></CopyRow>
              <CopyRow value={addressText(address)} label={`คัดลอกที่อยู่ ${address.label}`} copiedMessage="คัดลอกที่อยู่แล้ว"><p className="mt-1.5 text-pretty">{addressText(address)}</p></CopyRow>
            </CardContent>
          </Card>)}
      </div>
    </div>
  </section>
}
