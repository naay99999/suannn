import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@workspace/ui/components/badge'
import { Link } from 'react-router'
import { ServerDataTable, type ServerDataTableFeatures } from '@/components/server-data-table'
import { useCursorPagination } from '@/hooks/use-cursor-pagination'
import type { OrderDetail, OrderListInput } from '@/lib/orders/api'
import { ordersQuery } from '@/lib/orders/queries'
import { formatMoney, formatTimestamp } from '@/lib/format'

const column = createColumnHelper<ServerDataTableFeatures, OrderDetail>()
const columns: ColumnDef<ServerDataTableFeatures, OrderDetail>[] = column.columns([
  column.accessor('orderNumber', { header: 'คำสั่งซื้อ', cell: ({ row }) => <Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/orders/${row.original.id}`}>{row.original.orderNumber}</Link> }),
  column.accessor('recipientName', { header: 'ลูกค้า', cell: ({ row }) => <div><p className="font-medium">{row.original.recipientName}</p><p className="text-sm text-muted-foreground">{row.original.contactEmail}</p></div> }),
  column.accessor('createdAt', { header: 'วันที่', cell: ({ getValue }) => formatTimestamp(getValue()) }),
  column.accessor('status', { header: 'สถานะ', cell: ({ getValue }) => <Badge variant="outline">{getValue()}</Badge> }),
  column.accessor(row => row.payment.status, { id: 'payment', header: 'การชำระเงิน', cell: ({ row }) => <Badge variant={row.original.payment.status === 'awaiting_collection' ? 'secondary' : 'outline'}>{row.original.paymentMethod === 'cod' ? 'เก็บปลายทาง' : 'Stripe'} · {row.original.payment.status}</Badge> }),
  column.accessor('totalSatang', { header: () => <span className="block text-right">ยอดรวม</span>, cell: ({ getValue }) => <span className="block text-right font-medium">{formatMoney(getValue())}</span> }),
])

export function Component() {
  const { cursor, limit, canPrevious, next, previous, first, setLimit } = useCursorPagination([])
  const query: OrderListInput = { limit, cursor }
  const orders = useQuery(ordersQuery(query))
  return <section className="flex flex-col gap-6 px-4 lg:px-6"><div className="flex flex-col gap-1"><p className="text-sm font-medium text-muted-foreground">การขาย</p><h1 className="text-3xl font-semibold tracking-tight">คำสั่งซื้อ</h1><p className="text-muted-foreground">จัดการสถานะและการชำระเงินของคำสั่งซื้อ</p></div><ServerDataTable columns={columns} data={orders.data?.items ?? []} emptyDescription="คำสั่งซื้อใหม่จะแสดงที่นี่" emptyTitle="ยังไม่มีคำสั่งซื้อ" error={orders.error} getRowId={order => order.id} isPending={orders.isPending} isRefreshing={orders.isFetching && !orders.isPending} onRetry={() => void orders.refetch()} pagination={{ limit, nextCursor: orders.data?.nextCursor ?? null, canPrevious, hasCursor: Boolean(cursor), onNext: next, onPrevious: previous, onFirst: first, onLimitChange: setLimit }} /></section>
}
