import type { ReactNode } from 'react'
import { Badge } from '@workspace/ui/components/badge'
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card'
import { HugeiconsIcon } from '@hugeicons/react'
import { ChartDownIcon, ChartUpIcon } from '@hugeicons/core-free-icons'
import type { DashboardOverview } from '@/lib/dashboard/api'
import { formatMoney } from '@/lib/format'

const countFormatter = new Intl.NumberFormat('th-TH')
const percentFormatter = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

function Change({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null
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

function MetricCard({ label, value, change, footer, detail }: {
  label: string
  value: string
  change?: ReactNode
  footer: string
  detail: string
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle>
        {change}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className="line-clamp-1 font-medium">{footer}</div>
        <div className="text-muted-foreground">{detail}</div>
      </CardFooter>
    </Card>
  )
}

export function SectionCards({ overview, periodLabel }: { overview: DashboardOverview; periodLabel: string }) {
  const { summary, backlog } = overview
  const toFulfill = backlog.placed + backlog.processing + backlog.packed
  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      <MetricCard
        label="ยอดขาย"
        value={formatMoney(summary.revenueSatang)}
        change={<Change current={summary.revenueSatang} previous={summary.previousRevenueSatang} />}
        footer={periodLabel}
        detail={`ช่วงก่อนหน้า ${formatMoney(summary.previousRevenueSatang)}`}
      />
      <MetricCard
        label="คำสั่งซื้อ"
        value={countFormatter.format(summary.orderCount)}
        change={<Change current={summary.orderCount} previous={summary.previousOrderCount} />}
        footer={periodLabel}
        detail={`ช่วงก่อนหน้า ${countFormatter.format(summary.previousOrderCount)} รายการ`}
      />
      <MetricCard
        label="ยอดเฉลี่ยต่อคำสั่งซื้อ"
        value={formatMoney(summary.averageOrderValueSatang)}
        footer={periodLabel}
        detail="ไม่รวมคำสั่งซื้อที่ยกเลิกหรือยังไม่ชำระ"
      />
      <MetricCard
        label="รอจัดส่ง"
        value={countFormatter.format(toFulfill)}
        footer={`ใหม่ ${backlog.placed} · กำลังเตรียม ${backlog.processing} · แพ็กแล้ว ${backlog.packed}`}
        detail={`รอชำระเงินออนไลน์ ${countFormatter.format(backlog.pendingPayment)} รายการ`}
      />
    </div>
  )
}
