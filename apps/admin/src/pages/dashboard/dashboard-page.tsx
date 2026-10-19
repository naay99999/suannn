import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group'
import { QueryState } from '@/components/query-state'
import { ApiRequestError } from '@/lib/api-result'
import type { DashboardRange } from '@/lib/dashboard/api'
import { dashboardOverviewQuery } from '@/lib/dashboard/queries'
import { RecentOrders } from './_components/recent-orders'
import { SalesChart } from './_components/sales-chart'
import { SectionCards } from './_components/section-cards'

const ranges: Array<{ value: DashboardRange; label: string; period: string }> = [
  { value: '7d', label: '7 วัน', period: '7 วันล่าสุด' },
  { value: '30d', label: '30 วัน', period: '30 วันล่าสุด' },
  { value: '90d', label: '3 เดือน', period: '90 วันล่าสุด' },
]

function isRange(value: unknown): value is DashboardRange {
  return ranges.some((range) => range.value === value)
}

export function Component() {
  const [range, setRange] = useState<DashboardRange>('30d')
  const overview = useQuery(dashboardOverviewQuery(range))
  const periodLabel = ranges.find((option) => option.value === range)?.period ?? ''
  const forbidden = overview.error instanceof ApiRequestError && overview.error.status === 403

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 px-4 lg:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">ภาพรวม</h1>
          <p className="text-muted-foreground">ยอดขายและคำสั่งซื้อที่ต้องดำเนินการ</p>
        </div>
        <ToggleGroup
          aria-label="ช่วงเวลา"
          multiple={false}
          value={[range]}
          onValueChange={(value) => {
            if (isRange(value[0])) setRange(value[0])
          }}
          variant="outline"
          size="sm"
        >
          {ranges.map((option) => <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      {overview.isPending
        ? <div className="px-4 lg:px-6"><QueryState kind="loading" /></div>
        : overview.isError
          ? (
            <div className="px-4 lg:px-6">
              <QueryState
                kind={forbidden ? 'forbidden' : 'error'}
                message={forbidden ? undefined : overview.error.message}
                onRetry={forbidden ? undefined : () => void overview.refetch()}
              />
            </div>
          )
          : (
            <>
              <SectionCards overview={overview.data} periodLabel={periodLabel} />
              <div className="px-4 lg:px-6">
                <SalesChart daily={overview.data.daily} periodLabel={periodLabel} />
              </div>
              <div className="px-4 lg:px-6">
                <RecentOrders orders={overview.data.recentOrders} />
              </div>
            </>
          )}
    </>
  )
}
