import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@workspace/ui/components/badge'
import { Link, useSearchParams } from 'react-router'
import { ServerDataTable, type ServerDataTableFeatures, type ServerDataTableSorting, type SortDirection } from '@/components/server-data-table'
import { useCursorPagination } from '@/hooks/use-cursor-pagination'
import type { OrderDetail, OrderListInput } from '@/lib/orders/api'
import { ordersQuery } from '@/lib/orders/queries'
import { orderStatusLabels, paymentMethodLabels, paymentStatusLabels } from '@/lib/orders/labels'
import { formatMoney, formatTimestamp } from '@/lib/format'

const column = createColumnHelper<ServerDataTableFeatures, OrderDetail>()
const columns: ColumnDef<ServerDataTableFeatures, OrderDetail>[] = column.columns([
  column.accessor('orderNumber', { header: 'คำสั่งซื้อ', cell: ({ row }) => <Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/orders/${row.original.id}`}>{row.original.orderNumber}</Link> }),
  column.accessor('recipientName', { header: 'ลูกค้า', cell: ({ row }) => <div><p className="font-medium">{row.original.recipientName}</p><p className="text-sm text-muted-foreground">{row.original.contactEmail}</p></div> }),
  column.accessor('createdAt', { header: 'วันที่', cell: ({ getValue }) => formatTimestamp(getValue()) }),
  column.accessor('status', { header: 'สถานะ', cell: ({ getValue }) => <Badge variant={orderStatusLabels[getValue()].tone}>{orderStatusLabels[getValue()].label}</Badge> }),
  column.accessor(row => row.payment.status, { id: 'payment', header: 'การชำระเงิน', cell: ({ row }) => <Badge variant={paymentStatusLabels[row.original.payment.status].tone}>{paymentMethodLabels[row.original.paymentMethod]} · {paymentStatusLabels[row.original.payment.status].label}</Badge> }),
  column.accessor('totalSatang', { header: 'ยอดรวม', cell: ({ getValue }) => <span className="block text-right font-medium">{formatMoney(getValue())}</span> }),
])

type OrderSortField = NonNullable<NonNullable<OrderListInput>['sort']>

const sortableColumns = {
  orderNumber: { initialDirection: 'asc' },
  recipientName: { initialDirection: 'asc' },
  createdAt: { initialDirection: 'desc' },
  status: { initialDirection: 'asc' },
  totalSatang: { initialDirection: 'desc', align: 'end' },
} satisfies Record<OrderSortField, ServerDataTableSorting['columns'][string]>

function isSortField(value: string | null): value is OrderSortField {
  return value !== null && Object.hasOwn(sortableColumns, value)
}

function isSortDirection(value: string | null): value is SortDirection {
  return value === 'asc' || value === 'desc'
}

export function Component() {
  const [searchParams] = useSearchParams()
  const { cursor, limit, canPrevious, next, previous, first, setLimit, setFilters } = useCursorPagination(['sort', 'order'])
  const rawSort = searchParams.get('sort')
  const rawOrder = searchParams.get('order')
  const sort = isSortField(rawSort) ? rawSort : undefined
  const order = isSortDirection(rawOrder) ? rawOrder : undefined
  const query: OrderListInput = { limit, cursor, ...(sort ? { sort } : {}), ...(order ? { order } : {}) }
  const queryClient = useQueryClient()
  const orders = useQuery(ordersQuery(query))
  const nextCursor = orders.isPlaceholderData ? null : orders.data?.nextCursor
  const activeSort = sort ?? 'createdAt'
  const sorting: ServerDataTableSorting = {
    field: activeSort,
    direction: order ?? sortableColumns[activeSort].initialDirection,
    columns: sortableColumns,
    onChange: (field, direction) => setFilters({ sort: field, order: direction }),
    // A sort change returns to the first page, so warm exactly that query.
    onIntent: (field, direction) => {
      if (isSortField(field)) void queryClient.prefetchQuery(ordersQuery({ limit, sort: field, order: direction }))
    },
  }

  // Warm the next page so "next" renders from cache; staleTime keeps this from refetching on every render.
  useEffect(() => {
    if (nextCursor) void queryClient.prefetchQuery(ordersQuery({ limit, cursor: nextCursor, ...(sort ? { sort } : {}), ...(order ? { order } : {}) }))
  }, [limit, nextCursor, order, queryClient, sort])
  return <section className="flex flex-col gap-6 px-4 lg:px-6"><div className="flex flex-col gap-1"><p className="text-sm font-medium text-muted-foreground">การขาย</p><h1 className="text-3xl font-semibold tracking-tight">คำสั่งซื้อ</h1><p className="text-muted-foreground">จัดการสถานะและการชำระเงินของคำสั่งซื้อ</p></div><ServerDataTable columns={columns} data={orders.data?.items ?? []} emptyDescription="คำสั่งซื้อใหม่จะแสดงที่นี่" emptyTitle="ยังไม่มีคำสั่งซื้อ" error={orders.error} getRowId={row => row.id} isPending={orders.isPending} isRefreshing={orders.isFetching && !orders.isPending} onRetry={() => void orders.refetch()} sorting={sorting} pagination={{ limit, nextCursor: orders.data?.nextCursor ?? null, canPrevious, hasCursor: Boolean(cursor), onNext: next, onPrevious: previous, onFirst: first, onLimitChange: setLimit }} /></section>
}
