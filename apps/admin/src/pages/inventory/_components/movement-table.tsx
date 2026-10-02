import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { Link } from 'react-router'
import { ServerDataTable, type ServerDataTableFeatures } from '@/components/server-data-table'
import { formatQuantityDelta, formatTimestamp } from '@/lib/format'
import type { Movement } from '@/lib/inventory/api'
import { CopyableId } from './copyable-id'

const typeLabels: Record<Movement['type'], string> = {
  receipt: 'รับเข้า',
  write_off: 'ตัดสต็อก',
  count_adjustment: 'ปรับยอดนับ',
  reservation_confirm: 'ยืนยันการจอง',
  order_cancel_restore: 'คืนสต็อก',
}

const column = createColumnHelper<ServerDataTableFeatures, Movement>()
const columns: ColumnDef<ServerDataTableFeatures, Movement>[] = column.columns([
  column.accessor('occurredAt', { header: 'เวลา', cell: ({ getValue }) => formatTimestamp(getValue()) }),
  column.accessor('type', { header: 'รายการ', cell: ({ getValue }) => typeLabels[getValue()] }),
  column.accessor('quantityDelta', {
    header: 'เปลี่ยนแปลง',
    cell: ({ getValue }) => <span className="font-medium tabular-nums">{formatQuantityDelta(getValue())}</span>,
  }),
  column.accessor('balanceAfter', { header: 'ยอดหลังรายการ', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> }),
  column.accessor('lotId', {
    header: 'ล็อต',
    cell: ({ getValue }) => <div className="flex min-w-48 flex-col gap-1">
      <Link className="text-primary underline-offset-4 hover:underline" to={`/inventory/lots/${getValue()}`}>{getValue()}</Link>
      <CopyableId label="รหัสล็อต" value={getValue()} />
    </div>,
  }),
  column.accessor('operationId', {
    header: 'รายการอ้างอิง',
    cell: ({ getValue }) => <CopyableId label="รหัสรายการอ้างอิง" value={getValue()} />,
  }),
  column.accessor('actorId', { header: 'ผู้ดำเนินการ', cell: ({ getValue }) => getValue() }),
])

export function MovementTable({
  movements,
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
}: {
  movements: Movement[]
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
}) {
  return <ServerDataTable
    columns={columns}
    data={movements}
    emptyTitle="ยังไม่มีความเคลื่อนไหว"
    emptyDescription="รายการสต็อกจะแสดงเมื่อมีการรับเข้า ปรับยอด หรือยืนยันการจอง"
    error={error}
    getRowId={(row) => row.id}
    isPending={isPending}
    isRefreshing={isRefreshing}
    onRetry={onRetry}
    pagination={{ limit, nextCursor, canPrevious, hasCursor, onNext, onPrevious, onFirst, onLimitChange }}
  />
}
