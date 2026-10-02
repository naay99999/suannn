import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { ServerDataTable, type ServerDataTableFeatures } from '@/components/server-data-table'
import { formatDateOnly, formatTimestamp } from '@/lib/format'
import type { Lot } from '@/lib/inventory/api'
import { CopyableId } from './copyable-id'
import { cachedVariantMetadataIndex, variantLabel } from './variant-metadata'

type LotRow = Lot & {
  metadata?: Parameters<typeof variantLabel>[0]
  expired: boolean
}

const column = createColumnHelper<ServerDataTableFeatures, LotRow>()
const columns: ColumnDef<ServerDataTableFeatures, LotRow>[] = column.columns([
  column.accessor('lotCode', {
    header: 'รหัสล็อต',
    cell: ({ row }) => <Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/inventory/lots/${row.original.id}`}>{row.original.lotCode}</Link>,
  }),
  column.accessor('variantId', {
    header: 'รูปแบบสินค้า',
    cell: ({ row }) => <div className="flex min-w-52 flex-col gap-1">
      <Link className="text-sm hover:underline" to={`/inventory/variants/${row.original.variantId}${row.original.metadata ? `?productId=${row.original.metadata.product.id}` : ''}`}>{variantLabel(row.original.metadata) ?? row.original.variantId}</Link>
      <CopyableId label="รหัสรูปแบบสินค้า" value={row.original.variantId} />
    </div>,
  }),
  column.accessor('expiryDate', { header: 'วันหมดอายุ', cell: ({ getValue }) => formatDateOnly(getValue()) }),
  column.accessor('receivedAt', { header: 'รับเข้าเมื่อ', cell: ({ getValue }) => formatTimestamp(getValue()) }),
  column.accessor('onHandQuantity', {
    header: 'คงเหลือจริง',
    cell: ({ row }) => <span className="tabular-nums">{row.original.onHandQuantity}</span>,
  }),
  column.accessor('reservedQuantity', {
    header: 'ถูกจอง',
    cell: ({ row }) => <span className="tabular-nums">{row.original.reservedQuantity}</span>,
  }),
  column.display({
    id: 'status',
    header: 'สถานะล็อต',
    cell: ({ row }) => <div className="flex flex-wrap gap-1">
      {row.original.quarantinedAt && <Badge variant="destructive">กักกัน</Badge>}
      {row.original.expired && <Badge variant="secondary">หมดอายุ</Badge>}
      {row.original.onHandQuantity === 0 && <Badge variant="outline">หมดแล้ว</Badge>}
      {!row.original.quarantinedAt && !row.original.expired && row.original.onHandQuantity > 0 && <Badge>พร้อมใช้งาน</Badge>}
    </div>,
  }),
])

const bangkokDateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Bangkok',
})

function bangkokToday(): string {
  const parts = bangkokDateFormatter.formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function LotTable({
  lots,
  nextCursor,
  onNext,
  canPrevious,
  hasCursor,
  onPrevious,
  onFirst,
  limit,
  onLimitChange,
  isPending,
  isRefreshing,
  error,
  onRetry,
  showProductMetadata = false,
}: {
  lots: Lot[]
  nextCursor: string | null
  onNext: (cursor: string) => void
  canPrevious: boolean
  hasCursor: boolean
  onPrevious: () => void
  onFirst: () => void
  limit: number
  onLimitChange: (limit: number) => void
  isPending: boolean
  isRefreshing: boolean
  error: unknown | null
  onRetry: () => void
  showProductMetadata?: boolean
}) {
  const queryClient = useQueryClient()
  const today = bangkokToday()
  const metadataByVariant = showProductMetadata ? cachedVariantMetadataIndex(queryClient) : undefined
  const rows = lots.map((lot) => ({
    ...lot,
    expired: lot.expiryDate < today,
    metadata: metadataByVariant?.get(lot.variantId),
  }))
  return <ServerDataTable
    columns={columns}
    data={rows}
    emptyTitle="ยังไม่มีล็อตสินค้า"
    emptyDescription="ล็อตสินค้าจะปรากฏที่นี่เมื่อมีข้อมูลสต็อก"
    error={error}
    getRowId={(row) => row.id}
    isPending={isPending}
    isRefreshing={isRefreshing}
    onRetry={onRetry}
    pagination={{ limit, nextCursor, canPrevious, hasCursor, onNext, onPrevious, onFirst, onLimitChange }}
  />
}
