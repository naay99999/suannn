import { columnVisibilityFeature, createColumnHelper, FlexRender, tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table'
import { Link } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { formatMoney } from '@/lib/format'
import type { Discount } from '@/lib/discounts/api'
import { discountStatusLabels, discountUsesText, discountValueText } from '@/lib/discounts/labels'

const features = tableFeatures({ columnVisibilityFeature })
type Features = typeof features

const right = (text: string) => <span className="block text-right tabular-nums">{text}</span>
const column = createColumnHelper<Features, Discount>()

const columns: ColumnDef<Features, Discount>[] = column.columns([
  column.accessor('code', {
    header: 'โค้ด',
    cell: ({ row }) => <Link className="font-mono font-medium text-primary underline-offset-4 hover:underline" to={`/marketing/discounts/${row.original.id}`}>{row.original.code}</Link>,
  }),
  column.accessor('name', { header: 'ชื่อ', cell: ({ getValue }) => <span className="block min-w-32">{getValue()}</span> }),
  column.display({ id: 'value', header: 'ประเภทและมูลค่า', cell: ({ row }) => discountValueText(row.original) }),
  column.accessor('status', {
    header: 'สถานะ',
    cell: ({ getValue }) => <Badge variant={discountStatusLabels[getValue()].tone}>{discountStatusLabels[getValue()].label}</Badge>,
  }),
  column.display({ id: 'uses', header: () => right('ใช้แล้ว'), cell: ({ row }) => right(discountUsesText(row.original)) }),
  column.accessor('revenueSatang', { header: () => right('ยอดขาย'), cell: ({ getValue }) => right(formatMoney(getValue())) }),
  column.accessor('discountGivenSatang', { header: () => right('ส่วนลดที่ให้'), cell: ({ getValue }) => right(formatMoney(getValue())) }),
])

export function DiscountsTable({ discounts, filtered }: { discounts: Discount[]; filtered: boolean }) {
  const table = useTable({ features, data: discounts, columns })
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} colSpan={header.colSpan}>{header.isPlaceholder ? null : <FlexRender header={header} />}</TableHead>
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
                      <EmptyTitle>{filtered ? 'ไม่พบโค้ดในสถานะนี้' : 'ยังไม่มีโค้ดส่วนลด'}</EmptyTitle>
                      <EmptyDescription>{filtered ? 'ลองเลือกสถานะอื่น' : 'กด “สร้างโค้ด” เพื่อเริ่มต้น'}</EmptyDescription>
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
