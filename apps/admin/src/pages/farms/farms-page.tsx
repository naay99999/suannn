import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { buttonVariants } from '@workspace/ui/components/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { cn } from '@workspace/ui/lib/utils'
import { ServerDataTable, type ServerDataTableFeatures } from '@/components/server-data-table'
import { useCursorPagination } from '@/hooks/use-cursor-pagination'
import { authSessionQuery } from '@/lib/auth-session'
import { farmStatusLabel, farmStatusVariant, type Farm, type FarmListInput } from '@/lib/farms/api'
import { farmsQuery } from '@/lib/farms/queries'
import { formatDateOnly } from '@/lib/format'
import { hasPermission } from '@/lib/permissions'

const farmFilters = ['status'] as const
const emptyFarms: Farm[] = []
const column = createColumnHelper<ServerDataTableFeatures, Farm>()
const columns: ColumnDef<ServerDataTableFeatures, Farm>[] = column.columns([
  column.accessor('name', {
    header: 'ฟาร์ม',
    cell: ({ row }) => (
      <div className="flex min-w-48 flex-col gap-0.5">
        <Link className="truncate font-medium text-primary underline-offset-4 hover:underline" to={`/farms/${row.original.id}`}>
          {row.original.name}
        </Link>
        {row.original.farmerName && <span className="truncate text-sm text-muted-foreground">{row.original.farmerName}</span>}
        <span className="truncate text-xs text-muted-foreground">{row.original.slug}</span>
      </div>
    ),
  }),
  column.accessor('province', {
    header: 'พื้นที่',
    cell: ({ row }) => [row.original.district, row.original.province].filter(Boolean).join(', ') || '–',
  }),
  column.accessor('status', {
    header: 'สถานะ',
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        <Badge variant={farmStatusVariant(row.original.status)}>{farmStatusLabel(row.original.status)}</Badge>
        {row.original.isDemo && <Badge variant="outline">ตัวอย่าง</Badge>}
      </div>
    ),
  }),
  column.accessor('updatedAt', {
    header: 'แก้ไขล่าสุด',
    cell: ({ getValue }) => formatDateOnly(getValue().toISOString()),
  }),
])

export function Component() {
  const location = useLocation()
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canCreate = hasPermission(session, 'catalog:create')
  const { cursor, limit, canPrevious, next, previous, first, setLimit, setFilters } = useCursorPagination(farmFilters)
  const statusValue = new URLSearchParams(location.search).get('status')
  const status = statusValue === 'draft' || statusValue === 'published' || statusValue === 'archived' ? statusValue : undefined
  const query: FarmListInput = { status, limit, cursor }
  const farms = useQuery(farmsQuery(query))

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">จัดการแค็ตตาล็อก</p>
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">ฟาร์ม</h1>
          <p className="text-muted-foreground">ข้อมูลฟาร์มต้นทางที่แสดงในหน้าร้านและหน้าสินค้า</p>
        </div>
      </div>
      {canCreate && <Link className={cn(buttonVariants(), 'w-fit')} to="/farms/new">เพิ่มฟาร์ม</Link>}
      <Select
        items={[
          { label: 'ทุกสถานะ', value: 'all' },
          { label: 'ร่าง', value: 'draft' },
          { label: 'เผยแพร่แล้ว', value: 'published' },
          { label: 'เก็บถาวร', value: 'archived' },
        ]}
        value={status ?? 'all'}
        onValueChange={(value) => setFilters({ status: value === 'all' ? undefined : value ?? undefined })}
      >
        <SelectTrigger aria-label="กรองตามสถานะ" className="sm:w-48"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem value="all">ทุกสถานะ</SelectItem>
          <SelectItem value="draft">ร่าง</SelectItem>
          <SelectItem value="published">เผยแพร่แล้ว</SelectItem>
          <SelectItem value="archived">เก็บถาวร</SelectItem>
        </SelectGroup></SelectContent>
      </Select>
      <ServerDataTable
        columns={columns}
        data={farms.data?.items ?? emptyFarms}
        emptyDescription="ลองเปลี่ยนตัวกรองสถานะ หรือเพิ่มฟาร์มใหม่"
        emptyTitle="ยังไม่มีฟาร์ม"
        error={farms.error}
        getRowId={(farm) => farm.id}
        isPending={farms.isPending}
        isRefreshing={farms.isFetching && !farms.isPending}
        onRetry={() => void farms.refetch()}
        pagination={{
          limit,
          nextCursor: farms.data?.nextCursor ?? null,
          canPrevious,
          hasCursor: Boolean(cursor),
          onNext: next,
          onPrevious: previous,
          onFirst: first,
          onLimitChange: setLimit,
        }}
      />
    </section>
  )
}
