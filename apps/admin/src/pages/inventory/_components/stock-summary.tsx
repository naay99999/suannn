import type { StockSummary as StockSummaryData } from '@/lib/inventory/api'

const quantityLabels = [
  ['คงเหลือจริง', 'onHandQuantity'],
  ['ถูกจอง', 'reservedQuantity'],
  ['เข้าเกณฑ์', 'eligibleQuantity'],
  ['ขายได้', 'sellableQuantity'],
] as const

export function StockSummary({ summary }: { summary: StockSummaryData }) {
  return (
    <dl aria-label="สรุปสต็อก" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {quantityLabels.map(([label, key]) => <div className="flex flex-col gap-1 rounded-lg border p-4" key={key}>
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="text-2xl font-semibold tabular-nums">{summary[key]}</dd>
      </div>)}
    </dl>
  )
}
