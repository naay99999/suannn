import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@workspace/ui/components/chart'
import type { DashboardOverview } from '@/lib/dashboard/api'
import { formatMoney } from '@/lib/format'

const chartConfig = {
  revenueSatang: {
    label: 'ยอดขาย',
    color: 'var(--primary)',
  },
} satisfies ChartConfig

const dayFormatter = new Intl.DateTimeFormat('th-TH-u-ca-gregory', { day: 'numeric', month: 'short', timeZone: 'UTC' })

// Daily buckets are Asia/Bangkok calendar dates, so format them as plain dates at UTC midnight.
// Recharts may pass the bucket as a string, a parsed Date, or a non-date value while laying out the grid.
function formatDay(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : dayFormatter.format(value)
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return String(value ?? '')
  return dayFormatter.format(new Date(`${value}T00:00:00.000Z`))
}

export function SalesChart({ daily, periodLabel }: { daily: DashboardOverview['daily']; periodLabel: string }) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>ยอดขายรายวัน</CardTitle>
        <CardDescription>{periodLabel} ไม่รวมคำสั่งซื้อที่ยกเลิกหรือยังไม่ชำระ</CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <AreaChart data={daily}>
            <defs>
              <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-revenueSatang)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-revenueSatang)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={formatDay}
            />
            <ChartTooltip
              cursor={false}
              content={(
                <ChartTooltipContent
                  labelFormatter={formatDay}
                  formatter={(value, _name, item) => (
                    <div className="flex w-full justify-between gap-4">
                      <span className="text-muted-foreground">{(item.payload as { orderCount: number }).orderCount} คำสั่งซื้อ</span>
                      <span className="font-mono font-medium tabular-nums">{formatMoney(Number(value))}</span>
                    </div>
                  )}
                  indicator="dot"
                />
              )}
            />
            <Area
              dataKey="revenueSatang"
              type="monotone"
              fill="url(#fillRevenue)"
              stroke="var(--color-revenueSatang)"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
