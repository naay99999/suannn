import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { Badge } from '@workspace/ui/components/badge'
import { buttonVariants } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { cn } from '@workspace/ui/lib/utils'
import { authSessionQuery } from '@/lib/auth-session'
import {
  canCancelOrder,
  cancelCustomerOrder,
  downloadCustomerReceipt,
  paymentMethodLabel,
  paymentStatusLabel,
  paymentStatusVariants,
  refundStatusLabel,
  type StoreOrderDetail,
} from '@/lib/store-orders'
import { CancelOrderDialog } from '@/components/orders/cancel-order-dialog'
import { ShipmentDetails } from '@/components/orders/shipment-details'
import { BillingReceiptCard, ReceiptDownloadButton } from '@/components/orders/billing-receipt-card'
import { OrderPaymentActions } from '@/components/orders/order-payment-actions'
import type { getOrders } from './account-api'
import { orderQuery, orderQueryKey, ordersQueryKey } from './account-queries'
import { AccountQueryFeedback } from './account-query-feedback'
import { AccountPageHeading, AddressText, FulfilmentProgress, OrderItems, OrderStatus } from './account-ui'
import { accountSurface, accountSurfacePadding, standaloneTextLink } from './account-styles'
import { findOrderInPages, formatOrderDate, formatSatang, fulfilmentProgress, orderQuantity, replaceOrderInPages } from './order-display'
import { classifyAccountError } from './account-state'

type OrderPages = InfiniteData<Awaited<ReturnType<typeof getOrders>>, string | undefined>

export function Component() {
  const { orderId = '' } = useParams()
  const session = useQuery(authSessionQuery).data
  const userId = session?.user.id ?? ''
  const queryClient = useQueryClient()
  const order = useQuery({
    ...orderQuery(userId, orderId),
    enabled: Boolean(userId && orderId),
    // Render the copy already loaded by the orders list while the full detail (with checkout) arrives.
    placeholderData: () => findOrderInPages(queryClient.getQueryData<OrderPages>(ordersQueryKey(userId)), orderId),
  })

  if (order.isPending) return <OrderDetailSkeleton />
  if (order.isError && classifyAccountError(order.error) === 'not-found') return (
    <><title>ไม่พบคำสั่งซื้อ | suannn</title><Empty className="rounded-surface border border-dashed py-16"><EmptyHeader><EmptyTitle>ไม่พบรายการนี้</EmptyTitle><EmptyDescription>ตรวจสอบหมายเลขคำสั่งซื้อหรือกลับไปดูรายการทั้งหมด</EmptyDescription></EmptyHeader><EmptyContent><Link to="/account/orders" className={buttonVariants({ size: 'storefront' })}>กลับไปคำสั่งซื้อ</Link></EmptyContent></Empty></>
  )
  if (order.isError) return <AccountQueryFeedback error={order.error} retry={() => void order.refetch()} />
  const detail = order.data
  const refund = detail.payment.refund
  const shipping = { name: detail.recipientName, phone: detail.contactPhone, ...detail }
  const showTracking = fulfilmentProgress(detail.status) >= 0 || Boolean(detail.shipment)

  function onCancelled(next: StoreOrderDetail) {
    queryClient.setQueryData(orderQueryKey(userId, next.id), next)
    queryClient.setQueryData<OrderPages>(ordersQueryKey(userId), data => replaceOrderInPages(data, next))
    void queryClient.invalidateQueries({ queryKey: ordersQueryKey(userId) })
  }

  return (
    <>
      <title>{`${detail.orderNumber} | คำสั่งซื้อ | suannn`}</title>
      <BackLink />
      <AccountPageHeading
        title={detail.orderNumber}
        description={`สั่งซื้อเมื่อ ${formatOrderDate(detail.createdAt)} · ${detail.items.length} รายการ · ${orderQuantity(detail)} ชิ้น`}
        action={<OrderStatus status={detail.status} />}
      />

      <div className="mb-6 empty:hidden">
        <OrderPaymentActions order={detail}>
          {detail.receipt && <ReceiptDownloadButton receipt={detail.receipt} download={fileName => downloadCustomerReceipt(detail.id, fetch, fileName)} />}
          {canCancelOrder(detail) && !order.isPlaceholderData && <CancelOrderDialog triggerVariant="outline" orderNumber={detail.orderNumber} cancel={key => cancelCustomerOrder(detail.id, key)} onCancelled={onCancelled} />}
        </OrderPaymentActions>
      </div>

      {showTracking && <section aria-labelledby="tracking-title" className={cn('mb-6 flex flex-col gap-5', accountSurface, accountSurfacePadding)}>
        <h3 id="tracking-title" className="text-lg font-semibold">การจัดส่ง</h3>
        <FulfilmentProgress status={detail.status} />
        {detail.shipment
          ? <ShipmentDetails shipment={detail.shipment} />
          : <p className="text-sm text-muted-foreground">เลขพัสดุจะแสดงที่นี่เมื่อร้านส่งสินค้าแล้ว</p>}
      </section>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        <Card>
          <CardHeader><CardTitle role="heading" aria-level={3} className="text-lg font-semibold">สินค้าในคำสั่งซื้อ</CardTitle></CardHeader>
          <CardContent className="gap-6">
            <OrderItems order={detail} />
            <dl className="flex flex-col gap-3 border-t pt-5 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">ยอดรวมสินค้า</dt><dd className="tabular-nums">{formatSatang(detail.subtotalSatang)}</dd></div>
              {detail.discount && detail.discount.itemDiscountSatang > 0 && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">ส่วนลด ({detail.discount.code})</dt><dd className="tabular-nums text-success">−{formatSatang(detail.discount.itemDiscountSatang)}</dd></div>}
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">ค่าจัดส่ง</dt><dd className="flex gap-2 tabular-nums">{detail.discount && detail.discount.shippingDiscountSatang > 0 && <s className="text-muted-foreground">{formatSatang(detail.shippingSatang + detail.discount.shippingDiscountSatang)}</s>}<span>{detail.shippingSatang ? formatSatang(detail.shippingSatang) : 'ส่งฟรี'}</span></dd></div>
              <div className="flex items-baseline justify-between gap-4 border-t pt-4"><dt className="font-medium">ยอดรวมทั้งหมด</dt><dd className="text-xl font-semibold tabular-nums">{formatSatang(detail.totalSatang)}</dd></div>
              {refund && <div className="flex justify-between gap-4 text-muted-foreground"><dt>{refundStatusLabel(refund)}</dt><dd className="tabular-nums">−{formatSatang(refund.amountSatang)}</dd></div>}
            </dl>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle role="heading" aria-level={3} className="text-lg font-semibold">จัดส่งถึง</CardTitle></CardHeader>
            <CardContent className="leading-7"><p className="font-medium">{detail.recipientName}</p><p className="text-muted-foreground">{detail.contactPhone}</p><p className="text-muted-foreground"><AddressText address={detail} /></p></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle role="heading" aria-level={3} className="text-lg font-semibold">การชำระเงิน</CardTitle></CardHeader>
            <CardContent className="flex flex-col items-start gap-2">
              <p>{paymentMethodLabel(detail.paymentMethod)}</p>
              <Badge variant={paymentStatusVariants[detail.payment.status]}>{paymentStatusLabel(detail)}</Badge>
            </CardContent>
          </Card>
          <BillingReceiptCard billing={detail.billing} receipt={detail.receipt} shipping={shipping} />
        </div>
      </div>
    </>
  )
}

function BackLink() {
  return (
    <Link to="/account/orders" className={cn(standaloneTextLink, 'group mb-3 text-sm')}>
      <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
      คำสั่งซื้อทั้งหมด
    </Link>
  )
}

function OrderDetailSkeleton() {
  return (
    <div role="status" aria-label="กำลังโหลดคำสั่งซื้อ">
      <Skeleton className="mb-6 h-4 w-32" />
      <div className="mb-7 flex items-end justify-between gap-4"><div className="flex flex-col gap-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-64" /></div><Skeleton className="h-5 w-24" /></div>
      <Skeleton className="mb-6 h-28 w-full rounded-surface" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        <Skeleton className="h-72 rounded-surface" />
        <div className="flex flex-col gap-6"><Skeleton className="h-36 rounded-surface" /><Skeleton className="h-28 rounded-surface" /></div>
      </div>
    </div>
  )
}
