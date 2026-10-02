import { ArrowLeft01Icon, ArrowLeftDoubleIcon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  FlexRender,
  tableFeatures,
  useTable,
  type ColumnDef,
  type Row,
  type RowData,
} from '@tanstack/react-table'
import { Button } from '@workspace/ui/components/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { apiErrorMessage } from '@/lib/api-result'
import { QueryState } from './query-state'

const features = tableFeatures({})
export type ServerDataTableFeatures = typeof features

type ServerDataTableProps<TData extends RowData> = {
  columns: ColumnDef<ServerDataTableFeatures, TData>[]
  data: TData[]
  getRowId: (original: TData, index: number, parent?: Row<ServerDataTableFeatures, TData>) => string
  isPending: boolean
  isRefreshing: boolean
  error: unknown | null
  onRetry: () => void
  emptyTitle: string
  emptyDescription: string
  pagination: {
    limit: number
    nextCursor: string | null
    canPrevious: boolean
    hasCursor: boolean
    onNext: (cursor: string) => void
    onPrevious: () => void
    onFirst: () => void
    onLimitChange: (limit: number) => void
  }
}

export function ServerDataTable<TData extends RowData>({
  columns,
  data,
  getRowId,
  isPending,
  isRefreshing,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  pagination,
}: ServerDataTableProps<TData>) {
  const table = useTable({ features, data, columns, getRowId })

  if (isPending) return <QueryState kind="loading" />
  if (error) return <QueryState kind="error" message={apiErrorMessage(error)} onRetry={onRetry} />

  return (
    <div aria-busy={isRefreshing} className="flex flex-col gap-4">
      {isRefreshing && <p aria-live="polite" className="text-sm text-muted-foreground" role="status">กำลังอัปเดตข้อมูล...</p>}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder ? null : <FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0
              ? table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}><FlexRender cell={cell} /></TableCell>
                  ))}
                </TableRow>
              ))
              : <TableRow><TableCell className="p-0" colSpan={columns.length}><Empty className="min-h-48 border-0"><EmptyHeader><EmptyTitle>{emptyTitle}</EmptyTitle><EmptyDescription>{emptyDescription}</EmptyDescription></EmptyHeader></Empty></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">แสดงรายการละ</p>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Select
            items={[25, 50, 100].map((value) => ({ label: `${value}`, value: `${value}` }))}
            value={`${pagination.limit}`}
            onValueChange={(value) => { if (value) pagination.onLimitChange(Number(value)) }}
          >
            <SelectTrigger aria-label="จำนวนต่อหน้า" className="w-24" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent side="top"><SelectGroup>{[25, 50, 100].map((value) => <SelectItem key={value} value={`${value}`}>{value}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <Button aria-label="ไปหน้าแรก" disabled={!pagination.hasCursor} onClick={pagination.onFirst} size="icon" variant="outline">
            <HugeiconsIcon icon={ArrowLeftDoubleIcon} strokeWidth={2} />
          </Button>
          <Button aria-label="ไปหน้าก่อนหน้า" disabled={!pagination.canPrevious} onClick={pagination.onPrevious} size="icon" variant="outline">
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
          <Button aria-label="ไปหน้าถัดไป" disabled={!pagination.nextCursor} onClick={() => pagination.nextCursor && pagination.onNext(pagination.nextCursor)} size="icon" variant="outline">
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
          </Button>
        </div>
      </div>
    </div>
  )
}
