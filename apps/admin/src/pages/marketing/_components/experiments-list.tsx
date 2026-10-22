import { useQuery } from '@tanstack/react-query'
import { Badge } from '@workspace/ui/components/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { QueryState } from '@/components/query-state'
import { formatDateOnly } from '@/lib/format'
import type { MarketingExperiment } from '@/lib/marketing/api'
import { dateKey, formatPercent } from '@/lib/marketing/format'
import { marketingExperimentsQuery } from '@/lib/marketing/queries'
import { PosthogState } from './posthog-state'

const statuses = {
  draft: { label: 'ร่าง', variant: 'secondary' },
  running: { label: 'กำลังทดสอบ', variant: 'info' },
  complete: { label: 'จบแล้ว', variant: 'secondary' },
} as const

const day = (value: string | Date) => formatDateOnly(dateKey(value))

function verdict(experiment: MarketingExperiment): string {
  if (!experiment.readable) return 'ยังสรุปไม่ได้ — ดูใน PostHog'
  return experiment.winner ? `แบบ ${experiment.winner} ชนะ` : 'ยังสรุปไม่ได้'
}

function ExperimentCard({ experiment }: { experiment: MarketingExperiment }) {
  const status = statuses[experiment.status]
  const dates = experiment.startDate ? `${day(experiment.startDate)} – ${experiment.endDate ? day(experiment.endDate) : 'ปัจจุบัน'}` : null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {experiment.name}
          <Badge variant={status.variant}>{status.label}</Badge>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-4">
          {dates && <span>{dates}</span>}
          <a className="underline underline-offset-4" href={experiment.url} rel="noreferrer" target="_blank">เปิดใน PostHog</a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {experiment.variants && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>แบบ</TableHead>
                <TableHead className="text-right">ผู้เห็นการทดสอบ</TableHead>
                <TableHead className="text-right">ซื้อสำเร็จ</TableHead>
                <TableHead className="text-right">อัตราซื้อ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {experiment.variants.map((variant) => (
                <TableRow key={variant.key}>
                  <TableCell className="font-medium">{variant.key}</TableCell>
                  <TableCell className="text-right tabular-nums">{variant.exposures.toLocaleString('th-TH')}</TableCell>
                  <TableCell className="text-right tabular-nums">{variant.conversions.toLocaleString('th-TH')}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(variant.conversionRate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-sm font-medium">{verdict(experiment)}</p>
      </CardContent>
    </Card>
  )
}

export function ExperimentsList() {
  const experiments = useQuery(marketingExperimentsQuery)
  return (
    <section aria-labelledby="experiments-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold" id="experiments-heading">การทดลอง</h2>
        <p className="text-sm text-muted-foreground">รวมเฉพาะผู้เยี่ยมชมที่ยอมรับคุกกี้วิเคราะห์</p>
      </div>
      {experiments.isPending
        ? <QueryState kind="loading" />
        : experiments.isError
          ? <PosthogState error={experiments.error} onRetry={() => void experiments.refetch()} />
          : experiments.data.experiments.length === 0
            ? <QueryState kind="empty" message="ยังไม่มีการทดลอง" />
            : experiments.data.experiments.map((experiment) => <ExperimentCard experiment={experiment} key={experiment.id} />)}
    </section>
  )
}
