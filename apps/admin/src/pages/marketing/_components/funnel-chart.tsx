import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { QueryState } from '@/components/query-state'
import type { MarketingCampaign, MarketingFunnel } from '@/lib/marketing/api'
import { formatPercent, funnelPlatforms, platformLabel, type DateRange } from '@/lib/marketing/format'
import { marketingFunnelQuery } from '@/lib/marketing/queries'
import { PosthogState } from './posthog-state'

const all = 'all'
const hint = 'ผู้เยี่ยมชมที่ไม่ยอมรับคุกกี้วิเคราะห์จะถูกนับเฉพาะในหน้าเดียว ตัวเลขช่วงชำระเงินจึงอาจต่ำกว่าความจริง'

export function FunnelChart({ steps }: { steps: MarketingFunnel['steps'] }) {
  const max = Math.max(1, ...steps.map((step) => step.count))
  return (
    <ol aria-label="ขั้นตอนการซื้อ" className="flex flex-col gap-4">
      {steps.map((step) => (
        <li className="flex flex-col gap-1.5" key={step.event}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
            <span className="font-medium">{step.label}</span>
            <span className="text-muted-foreground tabular-nums">
              {step.count.toLocaleString('th-TH')} คน · {formatPercent(step.conversionFromPrevious)} จากขั้นก่อน · หลุด {formatPercent(step.dropOffFromPrevious)}
            </span>
          </div>
          <div aria-hidden="true" className="h-3 rounded-control bg-muted">
            <div className="h-full min-w-px rounded-control bg-primary" style={{ width: `${(step.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  )
}

export function FunnelSection({ range, enabled, campaigns, platform, campaign, onFilterChange }: {
  range: DateRange
  enabled: boolean
  campaigns: MarketingCampaign[]
  platform: string | undefined
  campaign: string | undefined
  onFilterChange: (filter: { platform?: string; campaign?: string }) => void
}) {
  const funnel = useQuery({ ...marketingFunnelQuery(range, { platform, campaign }), enabled })
  const options = new Map<string, string>()
  for (const row of campaigns) {
    if (platform && row.platform !== platform) continue
    options.set(row.campaignId, row.campaignName ?? row.campaignId)
  }
  const platformItems = [{ label: 'ทุกแพลตฟอร์ม', value: all }, ...funnelPlatforms.map((value) => ({ label: platformLabel(value), value }))]
  const campaignItems = [{ label: 'ทุกแคมเปญ', value: all }, ...Array.from(options, ([value, label]) => ({ label, value }))]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          ขั้นตอนการซื้อ
          <Tooltip>
            <TooltipTrigger render={<span aria-label={hint} className="inline-flex text-muted-foreground" role="img" tabIndex={0} />}>
              <HugeiconsIcon className="size-4" icon={InformationCircleIcon} strokeWidth={2} />
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        </CardTitle>
        <CardDescription>อิงข้อมูลผู้เยี่ยมชมใน PostHog</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          <Select items={platformItems} value={platform ?? all} onValueChange={(value) => onFilterChange({ platform: value && value !== all ? value : undefined })}>
            <SelectTrigger aria-label="แพลตฟอร์ม" className="sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              {platformItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
          <Select items={campaignItems} value={campaign ?? all} onValueChange={(value) => onFilterChange({ platform, campaign: value && value !== all ? value : undefined })}>
            <SelectTrigger aria-label="แคมเปญ" className="sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              {campaignItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
        </div>
        {!enabled ? null : funnel.isPending
          ? <QueryState kind="loading" />
          : funnel.isError
            ? <PosthogState error={funnel.error} onRetry={() => void funnel.refetch()} />
            : <FunnelChart steps={funnel.data.steps} />}
      </CardContent>
    </Card>
  )
}
