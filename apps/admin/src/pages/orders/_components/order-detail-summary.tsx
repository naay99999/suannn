import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import type { OrderDetail } from '@/lib/orders/api'
import { formatMoney, formatTimestamp } from '@/lib/format'
import { shipmentCarrierLabel } from '@/lib/orders/shipment'

export function OrderDetailSummary({ order, onDownloadReceipt, downloadPending = false }: { order: OrderDetail; onDownloadReceipt?: () => void; downloadPending?: boolean }) {
  const billing = order.billing
  const billingAddress = billing ? [billing.addressLine1, billing.addressLine2, billing.subdistrict, billing.district, billing.province, billing.postalCode].filter(Boolean).join(' ') : ''
  const receipt = order.receipt
  const address = [order.addressLine1, order.addressLine2, order.subdistrict, order.district, order.province, order.postalCode].filter(Boolean).join(' ')
  return <div className="grid gap-6 md:grid-cols-2">
    <section className="rounded-lg border p-5"><h2 className="font-semibold">ลูกค้าและจัดส่ง</h2><p className="mt-3">{order.recipientName}</p><p className="text-sm text-muted-foreground">{order.contactEmail} · {order.contactPhone}</p><p className="mt-2 text-sm">{address}</p>{order.shipment && <p className="mt-3 text-sm">พัสดุ: {shipmentCarrierLabel(order.shipment)} · <span className="font-mono">{order.shipment.trackingNumber}</span> · ส่งเมื่อ {formatTimestamp(order.shipment.shippedAt)}</p>}</section>
    <section className="rounded-lg border p-5"><h2 className="font-semibold">การชำระเงิน</h2><p className="mt-3">{order.paymentMethod === 'cod' ? 'เก็บเงินปลายทาง' : 'Stripe'} · {order.payment.status}</p><p className="text-sm text-muted-foreground">ยอดชำระ {formatMoney(order.payment.amountSatang)}</p>{order.payment.refund && <p className="mt-2 text-sm">คืนเงิน {formatMoney(order.payment.refund.amountSatang)} · {order.payment.refund.status}</p>}</section>
    {billing && <section className="rounded-lg border p-5"><h2 className="font-semibold">ที่อยู่ออกใบเสร็จ</h2><p className="mt-3">{billing.name}</p><p className="text-sm text-muted-foreground">{billing.phone}</p><p className="mt-2 text-sm">{billingAddress}</p></section>}
    {receipt && <section className="rounded-lg border p-5"><h2 className="font-semibold">ใบเสร็จ</h2><div className="mt-3 flex flex-wrap items-center gap-3"><span className="font-mono">{receipt.number}</span><Badge variant={receipt.status === 'issued' ? 'success' : 'destructive'}>{receipt.status === 'issued' ? 'ออกแล้ว' : 'ยกเลิกแล้ว'}</Badge><Button variant="outline" size="sm" disabled={!onDownloadReceipt || downloadPending} onClick={onDownloadReceipt}>{downloadPending ? 'กำลังดาวน์โหลด...' : 'ดาวน์โหลดใบเสร็จ'}</Button></div><p className="mt-2 text-xs text-muted-foreground">ออกเมื่อ {formatTimestamp(receipt.issuedAt)}</p></section>}
    <section className="rounded-lg border p-5 md:col-span-2"><h2 className="font-semibold">รายการสินค้า</h2><ul className="mt-3 divide-y">{order.items.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-3"><span>{item.productName} · {item.variantName} × {item.quantity}</span><span>{formatMoney(item.lineTotalSatang)}</span></li>)}</ul><div className="mt-3 space-y-2 border-t pt-3 text-sm"><p className="flex justify-between"><span>สินค้า</span><span>{formatMoney(order.subtotalSatang)}</span></p><p className="flex justify-between"><span>จัดส่ง</span><span>{formatMoney(order.shippingSatang)}</span></p><p className="flex justify-between font-semibold"><span>รวม</span><span>{formatMoney(order.totalSatang)}</span></p></div><p className="mt-4 text-xs text-muted-foreground">สร้างเมื่อ {formatTimestamp(order.createdAt)}</p></section>
  </div>
}
