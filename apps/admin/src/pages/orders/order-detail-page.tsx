import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { buttonVariants } from '@workspace/ui/components/button'
import { QueryState } from '@/components/query-state'
import { isUuid } from '@/lib/ids'
import { orderQuery } from '@/lib/orders/queries'
import { OrderDetailSummary } from './_components/order-detail-summary'

export function Component() {
  const { orderId = '' } = useParams()
  const valid = isUuid(orderId)
  const order = useQuery({ ...orderQuery(orderId), enabled: valid })
  if (!valid) return <section className="px-4 lg:px-6"><QueryState kind="not-found" message="รหัสคำสั่งซื้อไม่ถูกต้อง" /></section>
  if (order.isPending) return <section className="px-4 lg:px-6"><QueryState kind="loading" /></section>
  if (order.isError || !order.data) return <section className="px-4 lg:px-6"><QueryState kind={order.error && 'status' in order.error && order.error.status === 404 ? 'not-found' : 'error'} message="โหลดคำสั่งซื้อไม่ได้" onRetry={() => void order.refetch()} /></section>
  return <section className="flex flex-col gap-6 px-4 lg:px-6"><div><Link className={buttonVariants({ variant: 'outline', size: 'sm' })} to="/orders">กลับรายการคำสั่งซื้อ</Link><p className="mt-5 text-sm text-muted-foreground">คำสั่งซื้อ</p><h1 className="text-3xl font-semibold tracking-tight">{order.data.orderNumber}</h1><p className="mt-1 text-sm text-muted-foreground">{order.data.status}</p></div><OrderDetailSummary order={order.data} /></section>
}
