import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ChartDownIcon, ChartUpIcon, InformationCircleIcon } from '@hugeicons/core-free-icons'
import { Badge } from '@workspace/ui/components/badge'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import type { MarketingOverview } from '@/lib/marketing/api'
import { formatBaht, formatRoas } from '@/lib/marketing/format'

const countFormatter = new Intl.NumberFormat('th-TH')
const percentFormatter = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

function Change({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null || previous === 0) return null
  const change = (current - previous) / previous * 100
  return (
    <CardAction>
      <Badge variant="outline">
        <HugeiconsIcon icon={change < 0 ? ChartDownIcon : ChartUpIcon} strokeWidth={2} />
        {percentFormatter.format(change)}%
      </Badge>
    </CardAction>
  )
}

function MetricCard({ label, hint, value, change, previous }: {
  label: string
  hint?: string
  value: string
  change: ReactNode
  previous: string
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="flex items-center gap-1">
          {label}
          {hint && (
            <Tooltip>
              <TooltipTrigger render={<span aria-label={hint} className="inline-flex text-muted-foreground" role="img" tabIndex={0} />}>
                <HugeiconsIcon className="size-3.5" icon={InformationCircleIcon} strokeWidth={2} />
              </TooltipTrigger>
              <TooltipContent>{hint}</TooltipContent>
            </Tooltip>
          )}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle>
        {change}
      </CardHeader>
      <CardFooter className="text-sm text-muted-foreground">ช่วงก่อนหน้า {previous}</CardFooter>
    </Card>
  )
}

export function SummaryCards({ overview }: { overview: MarketingOverview }) {
  const { summary } = overview
  const { previous, unmatched } = summary
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
        <MetricCard
          label="ค่าโฆษณา"
          value={formatBaht(summary.spendSatang)}
          change={<Change current={summary.spendSatang} previous={previous.spendSatang} />}
          previous={formatBaht(previous.spendSatang)}
        />
        <MetricCard
          label="ยอดขายจากโฆษณา"
          hint="ยังไม่หักยอดคืนเงิน"
          value={formatBaht(summary.revenueSatang)}
          change={<Change current={summary.revenueSatang} previous={previous.revenueSatang} />}
          previous={formatBaht(previous.revenueSatang)}
        />
        <MetricCard
          label="คำสั่งซื้อจากโฆษณา"
          value={countFormatter.format(summary.orders)}
          change={<Change current={summary.orders} previous={previous.orders} />}
          previous={countFormatter.format(previous.orders)}
        />
        <MetricCard
          label="ROAS"
          value={formatRoas(summary.roas)}
          change={<Change current={summary.roas} previous={previous.roas} />}
          previous={formatRoas(previous.roas)}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        ต้นทุนต่อคำสั่งซื้อ {summary.costPerOrderSatang === null ? '—' : formatBaht(summary.costPerOrderSatang)}
        {' · '}ROAS เท่าทุน {formatRoas(overview.breakEvenRoas)}
        {' · '}คำสั่งซื้อที่ไม่ได้มาจากโฆษณา {countFormatter.format(summary.nonAdOrders)} รายการ
      </p>
      {unmatched.orders > 0 && (
        <p className="text-sm text-muted-foreground">
          ยอดขายจาก UTM ที่ไม่พบค่าโฆษณา: {formatBaht(unmatched.revenueSatang)} ({countFormatter.format(unmatched.orders)} รายการ)
        </p>
      )}
    </div>
  )
}
