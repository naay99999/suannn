import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader } from '@workspace/ui/components/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { authSessionQuery } from '@/lib/auth-session'
import { ordersQuery } from './account-queries'
import { AccountQueryFeedback } from './account-query-feedback'
import { AccountPageHeading, OrderItems, OrderStatus } from './account-ui'
import { formatOrderDate, formatSatang, mergeOrderPages } from './order-display'

export function Component() {
  const session = useQuery(authSessionQuery).data
  const userId = session?.user.id ?? ''
  const orders = useInfiniteQuery({ ...ordersQuery(userId), enabled: Boolean(userId) })
  const items = mergeOrderPages(orders.data?.pages ?? [])

  return (
    <>
      <title>คำสั่งซื้อของฉัน | suannn</title>
      <AccountPageHeading title="คำสั่งซื้อของฉัน" description="รายการที่สั่งซื้อด้วยบัญชีนี้" />
      {orders.isPending ? <p role="status" className="py-12 text-muted-foreground">กำลังโหลดคำสั่งซื้อ...</p> : orders.isError ? (
        <AccountQueryFeedback error={orders.error} retry={() => void orders.refetch()} />
      ) : items.length ? <>
        <div className="flex flex-col gap-5">
          {items.map(order => <Card key={order.id}>
            <CardHeader className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-semibold">{order.orderNumber}</p><p className="mt-1 text-sm text-muted-foreground">{formatOrderDate(order.createdAt)}</p></div><OrderStatus status={order.status} /></CardHeader>
            <CardContent className="gap-6"><OrderItems order={order} /><div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5"><p className="text-sm">ยอดรวม <strong className="ml-2 text-lg tabular-nums">{formatSatang(order.totalSatang)}</strong></p><Link to={`/account/orders/${order.id}`} className="text-sm font-medium text-primary-ink underline underline-offset-4">ดูรายละเอียดคำสั่งซื้อ</Link></div></CardContent>
          </Card>)}
        </div>
        {orders.hasNextPage && <div className="mt-7 text-center"><Button type="button" variant="outline" disabled={orders.isFetchingNextPage} onClick={() => void orders.fetchNextPage()}>{orders.isFetchingNextPage ? 'กำลังโหลด...' : 'ดูรายการเพิ่มเติม'}</Button></div>}
        {orders.isFetchNextPageError && <p role="alert" className="mt-4 text-center text-destructive">โหลดรายการเพิ่มเติมไม่ได้ กรุณาลองใหม่</p>}
      </> : <Empty className="rounded-3xl border bg-card py-16"><EmptyHeader><EmptyTitle>ยังไม่มีคำสั่งซื้อ</EmptyTitle><EmptyDescription>เมื่อสั่งซื้อด้วยบัญชีนี้ รายการจะแสดงที่นี่</EmptyDescription></EmptyHeader></Empty>}
    </>
  )
}
