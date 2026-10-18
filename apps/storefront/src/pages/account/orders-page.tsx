import { useId, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { cn } from '@workspace/ui/lib/utils'
import { authSessionQuery } from '@/lib/auth-session'
import type { CustomerOrder } from './account-api'
import { ordersQuery } from './account-queries'
import { AccountQueryFeedback } from './account-query-feedback'
import { AccountPageHeading, FulfilmentProgress, OrderStatus } from './account-ui'
import { accountSurface, accountSurfacePadding, standaloneTextLink } from './account-styles'
import { formatOrderDate, formatSatang, mergeOrderPages, orderQuantity, previewOrderItems } from './order-display'
import { ButtonSpinner } from '@/components/loading/button-spinner'

const itemPreviewLimit = 3

export function Component() {
  const session = useQuery(authSessionQuery).data
  const userId = session?.user.id ?? ''
  const orders = useInfiniteQuery({ ...ordersQuery(userId), enabled: Boolean(userId) })
  const items = mergeOrderPages(orders.data?.pages ?? [])

  return (
    <>
      <title>คำสั่งซื้อของฉัน | suannn</title>
      <AccountPageHeading title="คำสั่งซื้อของฉัน" description="รายการที่สั่งซื้อด้วยบัญชีนี้ เรียงจากล่าสุด" />
      {orders.isPending ? <OrderCardsSkeleton /> : orders.isError ? (
        <AccountQueryFeedback error={orders.error} retry={() => void orders.refetch()} />
      ) : items.length ? <>
        <ul aria-label="คำสั่งซื้อ" className="flex flex-col gap-4">
          {items.map(order => <li key={order.id} className="[contain-intrinsic-size:auto_14rem] [content-visibility:auto]"><OrderCard order={order} /></li>)}
        </ul>
        {orders.hasNextPage && <div className="mt-8 flex justify-center"><Button type="button" variant="outline" disabled={orders.isFetchingNextPage} onClick={() => void orders.fetchNextPage()}><ButtonSpinner show={orders.isFetchingNextPage} />{orders.isFetchingNextPage ? 'กำลังโหลด...' : 'ดูคำสั่งซื้อก่อนหน้า'}</Button></div>}
        {orders.isFetchNextPageError && <p role="alert" className="mt-4 text-center text-sm text-destructive">โหลดคำสั่งซื้อก่อนหน้าไม่ได้ กรุณาลองใหม่</p>}
      </> : <Empty className="rounded-surface border border-dashed py-16">
        <EmptyHeader><EmptyTitle>ยังไม่มีคำสั่งซื้อ</EmptyTitle><EmptyDescription>เมื่อสั่งซื้อด้วยบัญชีนี้ สถานะการจัดส่งและใบเสร็จจะแสดงที่นี่</EmptyDescription></EmptyHeader>
        <EmptyContent><Link to="/products" className={buttonVariants({ size: 'storefront' })}>เลือกซื้อผลผลิต</Link></EmptyContent>
      </Empty>}
    </>
  )
}

function OrderCard({ order }: { order: CustomerOrder }) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const { shown, hidden } = previewOrderItems(order.items, itemPreviewLimit)
  const visible = expanded ? order.items : shown
  const detailPath = `/account/orders/${order.id}`

  return (
    <article aria-labelledby={`${listId}-title`} className={accountSurface}>
      <header className="flex flex-col gap-4 px-5 pt-5 md:px-6 md:pt-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h3 id={`${listId}-title`} className="font-semibold tabular-nums">
              <Link to={detailPath} className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{order.orderNumber}</Link>
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              <time dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time> · {order.items.length} รายการ · <span className="tabular-nums">{orderQuantity(order)}</span> ชิ้น
            </p>
          </div>
          <OrderStatus status={order.status} />
        </div>
        <FulfilmentProgress status={order.status} />
      </header>

      <ul id={listId} className="mx-5 mt-4 divide-y border-y md:mx-6">
        {visible.map(item => <li key={item.id} className="flex min-w-0 items-baseline justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{item.productName}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.variantName} · {item.unit}</p>
          </div>
          <p className="shrink-0 text-right text-sm tabular-nums">
            <span className="text-muted-foreground">×{item.quantity}</span>
            <span className="ml-3 font-medium">{formatSatang(item.lineTotalSatang)}</span>
          </p>
        </li>)}
      </ul>
      {hidden.length > 0 && <div className="mx-5 md:mx-6">
        <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)} className={cn(standaloneTextLink, 'text-sm')}>
          {expanded ? 'ย่อรายการ' : `ดูอีก ${hidden.length} รายการ`}
          <HugeiconsIcon icon={ArrowDown01Icon} className={cn('size-4 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>}

      <footer className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 pb-5 md:px-6 md:pb-6', hidden.length ? 'pt-1' : 'pt-4')}>
        <p className="text-sm text-muted-foreground">ยอดรวม <strong className="ml-1.5 text-lg font-semibold tabular-nums text-foreground">{formatSatang(order.totalSatang)}</strong></p>
        {order.status === 'pending_payment'
          ? <Link to={detailPath} className={buttonVariants()}>ชำระเงินต่อ<HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" /></Link>
          : <Link to={detailPath} aria-label={`ดูรายละเอียดคำสั่งซื้อ ${order.orderNumber}`} className={cn(standaloneTextLink, 'group text-sm')}>
            ดูรายละเอียด<HugeiconsIcon icon={ArrowRight01Icon} className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
          </Link>}
      </footer>
    </article>
  )
}

function OrderCardsSkeleton() {
  return (
    <div role="status" aria-label="กำลังโหลดคำสั่งซื้อ" className="flex flex-col gap-4">
      {[0, 1, 2].map(card => <div key={card} className={cn('flex flex-col gap-4', accountSurface, accountSurfacePadding)}>
        <div className="flex justify-between gap-4"><div className="flex flex-col gap-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-52" /></div><Skeleton className="h-5 w-20" /></div>
        <div className="flex flex-col gap-3 border-y py-3"><Skeleton className="h-4 w-3/5" /><Skeleton className="h-4 w-2/5" /></div>
        <div className="flex justify-between gap-4"><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-24" /></div>
      </div>)}
    </div>
  )
}
