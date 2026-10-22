import {
  columnVisibilityFeature, createSortedRowModel, createColumnHelper, FlexRender,
  rowSortingFeature, sortFn_alphanumeric, tableFeatures, useTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@workspace/ui/components/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import type { MarketingCampaign } from '@/lib/marketing/api'
import { formatBaht, formatRoas, platformLabel } from '@/lib/marketing/format'
import { VerdictBadge } from './verdict-badge'

const features = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
})
type Features = typeof features

const verdictRank = { profit: 4, breakeven: 3, loss: 2, no_sales: 1 } as const
const right = (text: string) => <span className="block text-right tabular-nums">{text}</span>
const column = createColumnHelper<Features, MarketingCampaign>()

// Unknown values sort below known ones.
const columns: ColumnDef<Features, MarketingCampaign>[] = column.columns([
  column.accessor((row) => row.campaignName ?? row.campaignId, {
    id: 'campaign',
    header: 'แคมเปญ',
    sortFn: 'alphanumeric',
    cell: ({ row }) => <div className="flex min-w-40 flex-col">
      <span className="font-medium">{row.original.campaignName ?? row.original.campaignId}</span>
      <span className="text-xs text-muted-foreground">{row.original.platform ? platformLabel(row.original.platform) : row.original.utmSource ?? '—'} · {row.original.campaignId}</span>
    </div>,
  }),
  column.accessor((row) => row.spendSatang ?? -1, {
    id: 'spend', header: 'ค่าโฆษณา', sortFn: 'alphanumeric',
    cell: ({ row }) => right(row.original.spendSatang === null ? '—' : formatBaht(row.original.spendSatang)),
  }),
  column.accessor('orders', { header: 'คำสั่งซื้อ', sortFn: 'alphanumeric', cell: ({ getValue }) => right(String(getValue())) }),
  column.accessor('revenueSatang', { header: 'ยอดขาย', sortFn: 'alphanumeric', cell: ({ getValue }) => right(formatBaht(getValue())) }),
  column.accessor((row) => row.roas ?? -1, {
    id: 'roas', header: 'ROAS', sortFn: 'alphanumeric',
    cell: ({ row }) => right(formatRoas(row.original.roas)),
  }),
  column.accessor((row) => row.costPerOrderSatang ?? -1, {
    id: 'costPerOrder', header: 'ต้นทุนต่อคำสั่งซื้อ', sortFn: 'alphanumeric',
    cell: ({ row }) => right(row.original.costPerOrderSatang === null ? '—' : formatBaht(row.original.costPerOrderSatang)),
  }),
  column.accessor((row) => (row.verdict ? verdictRank[row.verdict] : 0), {
    id: 'verdict', header: 'ผลลัพธ์', sortFn: 'alphanumeric',
    cell: ({ row }) => <VerdictBadge verdict={row.original.verdict} />,
  }),
])

export function CampaignTable({ campaigns }: { campaigns: MarketingCampaign[] }) {
  const table = useTable({ features, data: campaigns, columns, initialState: { sorting: [{ id: 'spend', desc: true }] } })
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} colSpan={header.colSpan} aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined}>
                  {header.isPlaceholder ? null : (
                    <Button className="-ml-2" onClick={() => header.column.toggleSorting(header.column.getIsSorted() === 'asc')} size="sm" variant="ghost">
                      <FlexRender header={header} />
                      <HugeiconsIcon data-icon="inline-end" icon={ArrowDown01Icon} strokeWidth={2} />
                    </Button>
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length
            ? table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => <TableCell key={cell.id}><FlexRender cell={cell} /></TableCell>)}
              </TableRow>
            ))
            : (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  <Empty className="min-h-48 border-0">
                    <EmptyHeader>
                      <EmptyTitle>ยังไม่มีแคมเปญในช่วงนี้</EmptyTitle>
                      <EmptyDescription>เมื่อมีค่าโฆษณาหรือคำสั่งซื้อที่มี UTM แคมเปญจะแสดงที่นี่</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            )}
        </TableBody>
      </Table>
    </div>
  )
}
