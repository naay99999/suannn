import { ArrowRight01Icon, Call02Icon, DeliveryTruck01Icon, Download04Icon, File01Icon, Mail01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { CopyRow } from '@/components/copy-button'
import type { OrderDetail } from '@/lib/orders/api'
import { canIssueReceipt } from '@/lib/orders/eligibility'
import { paymentMethodLabels, paymentStatusLabels, refundStatusLabels } from '@/lib/orders/labels'
import { formatMoney, formatTimestamp } from '@/lib/format'
import { shipmentCarrierLabel } from '@/lib/orders/shipment'

function joinAddress(parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="text-right tabular-nums">{children}</dd></div>
}

export function OrderDetailSummary({ order, customerHref, onViewReceipt, onDownloadReceipt, downloadPending = false }: { order: OrderDetail; customerHref?: string; onViewReceipt?: () => void; onDownloadReceipt?: () => void; downloadPending?: boolean }) {
  const billing = order.billing
  const receipt = order.receipt
  const address = joinAddress([order.addressLine1, order.addressLine2, order.subdistrict, order.district, order.province, order.postalCode])
  const billingAddress = billing ? joinAddress([billing.addressLine1, billing.addressLine2, billing.subdistrict, billing.district, billing.province, billing.postalCode]) : ''
  const payment = paymentStatusLabels[order.payment.status]
  const refund = order.payment.refund
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0)
  const receiptHint = canIssueReceipt(order)

  return <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
    <Card>
      <CardHeader><CardTitle>รายการสินค้า <span className="font-normal text-muted-foreground">· {itemCount} ชิ้น</span></CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {order.items.length === 0
          ? <p className="text-sm text-muted-foreground">ไม่มีรายการสินค้า</p>
          : <ul className="divide-y">{order.items.map(item => <li key={item.id} className="flex items-start justify-between gap-4 py-3 first:pt-0">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="font-medium">{item.productName}</p>
              <p className="text-sm text-muted-foreground">{item.variantName} · <span className="font-mono text-xs">{item.sku}</span></p>
              <p className="text-sm text-muted-foreground tabular-nums">{formatMoney(item.unitPriceSatang)} × {item.quantity} {item.unit}</p>
            </div>
            <p className="shrink-0 font-medium tabular-nums">{formatMoney(item.lineTotalSatang)}</p>
          </li>)}</ul>}
        <dl className="flex flex-col gap-2 border-t pt-4 text-sm">
          <Row label="ค่าสินค้า">{formatMoney(order.subtotalSatang)}</Row>
          <Row label="ค่าจัดส่ง">{order.shippingSatang === 0 ? 'ฟรี' : formatMoney(order.shippingSatang)}</Row>
          <div className="flex items-baseline justify-between gap-4 border-t pt-3 text-base font-semibold"><dt>ยอดรวม</dt><dd className="tabular-nums">{formatMoney(order.totalSatang)}</dd></div>
        </dl>
      </CardContent>
    </Card>

    <div className="flex flex-col gap-4">
      <Card size="sm">
        <CardHeader><CardTitle>ลูกค้าและที่อยู่จัดส่ง</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <CopyRow value={order.recipientName} label="คัดลอกชื่อผู้รับ" copiedMessage="คัดลอกชื่อผู้รับแล้ว">
            {customerHref
              ? <Link to={customerHref} title="ดูรายละเอียดลูกค้า" className="group/customer flex w-fit items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">{order.recipientName}<HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5 transition-transform group-hover/customer:translate-x-0.5" /><span className="sr-only"> ดูรายละเอียดลูกค้า</span></Link>
              : <p className="flex flex-wrap items-center gap-2 font-medium">{order.recipientName}{order.customerId === null && <Badge variant="outline">ไม่มีบัญชี</Badge>}</p>}
          </CopyRow>
          <CopyRow value={order.contactEmail} label="คัดลอกอีเมล" copiedMessage="คัดลอกอีเมลแล้ว">
            <a className="flex w-fit items-center gap-1.5 break-all text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`mailto:${order.contactEmail}`}><HugeiconsIcon icon={Mail01Icon} strokeWidth={2} className="size-3.5 shrink-0" />{order.contactEmail}</a>
          </CopyRow>
          <CopyRow value={order.contactPhone} label="คัดลอกเบอร์โทร" copiedMessage="คัดลอกเบอร์โทรแล้ว">
            <a className="flex w-fit items-center gap-1.5 text-muted-foreground tabular-nums underline-offset-4 hover:text-foreground hover:underline" href={`tel:${order.contactPhone}`}><HugeiconsIcon icon={Call02Icon} strokeWidth={2} className="size-3.5 shrink-0" />{order.contactPhone}</a>
          </CopyRow>
          <CopyRow value={address} label="คัดลอกที่อยู่จัดส่ง" copiedMessage="คัดลอกที่อยู่จัดส่งแล้ว">
            <p className="mt-1.5 text-pretty">{address}</p>
          </CopyRow>
          {order.shipment && <div className="mt-1.5 flex gap-2 rounded-field bg-muted/60 p-3">
            <HugeiconsIcon icon={DeliveryTruck01Icon} strokeWidth={2} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="font-medium">{shipmentCarrierLabel(order.shipment)}</p>
              <CopyRow value={order.shipment.trackingNumber} label="คัดลอกเลขพัสดุ" copiedMessage="คัดลอกเลขพัสดุแล้ว"><p className="font-mono break-all">{order.shipment.trackingNumber}</p></CopyRow>
              <p className="text-xs text-muted-foreground">ส่งเมื่อ {formatTimestamp(order.shipment.shippedAt)}</p>
            </div>
          </div>}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader><CardTitle>การชำระเงิน</CardTitle></CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-2">
            <Row label="วิธีชำระ">{paymentMethodLabels[order.paymentMethod]}</Row>
            <Row label="สถานะ"><Badge variant={payment.tone}>{payment.label}</Badge></Row>
            <Row label="ยอดชำระ">{formatMoney(order.payment.amountSatang)}</Row>
            {refund && <Row label="คืนเงิน"><span className="inline-flex items-center gap-2">{formatMoney(refund.amountSatang)}<Badge variant={refundStatusLabels[refund.status].tone}>{refundStatusLabels[refund.status].label}</Badge></span></Row>}
          </dl>
        </CardContent>
      </Card>

      {(receipt || receiptHint) && <Card size="sm">
        <CardHeader><CardTitle>ใบเสร็จ</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {receipt
            ? <>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono">{receipt.number}</span><Badge variant={receipt.status === 'issued' ? 'success' : 'destructive'}>{receipt.status === 'issued' ? 'ออกแล้ว' : 'ยกเลิกแล้ว'}</Badge></div>
              <p className="text-xs text-muted-foreground">ออกเมื่อ {formatTimestamp(receipt.issuedAt)}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" disabled={!onViewReceipt} onClick={onViewReceipt}><HugeiconsIcon data-icon="inline-start" icon={File01Icon} strokeWidth={2} />ดูใบเสร็จ</Button>
                <Button variant="outline" size="sm" disabled={!onDownloadReceipt || downloadPending} onClick={onDownloadReceipt}><HugeiconsIcon data-icon="inline-start" icon={Download04Icon} strokeWidth={2} />{downloadPending ? 'กำลังดาวน์โหลด...' : 'ดาวน์โหลด'}</Button>
              </div>
            </>
            : <p className="text-pretty text-muted-foreground">ยังไม่มีใบเสร็จสำหรับคำสั่งซื้อนี้ หากยังไม่ได้ตั้งค่าข้อมูลผู้ขาย ให้ตั้งค่าในหน้า Settings ก่อน แล้วกด “ออกใบเสร็จ”</p>}
        </CardContent>
      </Card>}

      {billing && <Card size="sm">
        <CardHeader><CardTitle>ที่อยู่ออกใบเสร็จ</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <CopyRow value={billing.name} label="คัดลอกชื่อออกใบเสร็จ" copiedMessage="คัดลอกชื่อออกใบเสร็จแล้ว"><p className="font-medium">{billing.name}</p></CopyRow>
          <CopyRow value={billing.phone} label="คัดลอกเบอร์โทรออกใบเสร็จ" copiedMessage="คัดลอกเบอร์โทรออกใบเสร็จแล้ว"><p className="text-muted-foreground tabular-nums">{billing.phone}</p></CopyRow>
          <CopyRow value={billingAddress} label="คัดลอกที่อยู่ออกใบเสร็จ" copiedMessage="คัดลอกที่อยู่ออกใบเสร็จแล้ว"><p className="mt-1.5 text-pretty">{billingAddress}</p></CopyRow>
        </CardContent>
      </Card>}
    </div>
  </div>
}
