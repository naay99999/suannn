import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { QueryState } from '@/components/query-state'
import { authSessionQuery } from '@/lib/auth-session'
import { STALE_SYNC_MS } from '@/lib/integrations/health'
import { trackingStatusQuery } from '@/lib/integrations/queries'
import { hasPermission } from '@/lib/permissions'
import { isDateKey, presetLabels, presetRange, warningText, type DateRange, type RangePreset } from '@/lib/marketing/format'
import { marketingOverviewQuery } from '@/lib/marketing/queries'
import { CampaignTable } from './_components/campaign-table'
import { DateRangePicker } from './_components/date-range-picker'
import { MarginSetting } from './_components/margin-setting'
import { SummaryCards } from './_components/summary-cards'
import { SyncButton } from './_components/sync-button'
import { UtmTemplates } from './_components/utm-templates'

const defaultPreset: RangePreset = '7d'

function isPreset(value: string | null): value is RangePreset {
  return value !== null && value in presetLabels
}

// The range lives in the URL as YYYY-MM-DD strings that are serialised here, never from Date objects.
function useMarketingRange() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('range')
  const from = params.get('from')
  const to = params.get('to')
  const customValid = isDateKey(from) && isDateKey(to) && from <= to
  const preset: RangePreset = isPreset(requested) && (requested !== 'custom' || customValid) ? requested : defaultPreset
  const range: DateRange = preset === 'custom' ? { from: from!, to: to! } : presetRange(preset)
  function setPreset(next: RangePreset) {
    const nextParams = new URLSearchParams(params)
    nextParams.set('range', next)
    if (next === 'custom') {
      nextParams.set('from', range.from)
      nextParams.set('to', range.to)
    } else {
      nextParams.delete('from')
      nextParams.delete('to')
    }
    setParams(nextParams, { replace: true })
  }
  function setCustom(next: DateRange) {
    const nextParams = new URLSearchParams(params)
    nextParams.set('range', 'custom')
    nextParams.set('from', next.from)
    nextParams.set('to', next.to)
    setParams(nextParams, { replace: true })
  }
  return { preset, range, setPreset, setCustom }
}

// Needs settings:read; staff without it never see the warning, and a failed request is ignored.
function useStaleSpendWarning() {
  const session = useQuery(authSessionQuery)
  const tracking = useQuery({ ...trackingStatusQuery, enabled: hasPermission(session.data, 'settings:read'), retry: false })
  const now = Date.now()
  return tracking.data?.adSpend.some((row) => {
    if (!row.configured) return false
    if (row.lastRunStatus === 'failed' || !row.lastSuccessAt) return true
    return now - new Date(row.lastSuccessAt).getTime() > STALE_SYNC_MS
  }) ?? false
}

export function Component() {
  const { preset, range, setPreset, setCustom } = useMarketingRange()
  const session = useQuery(authSessionQuery)
  const canUpdate = hasPermission(session.data, 'marketing:update')
  const overview = useQuery(marketingOverviewQuery(range))
  const stale = useStaleSpendWarning()

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 lg:px-6">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">การตลาด</h1>
          <DateRangePicker onCustomChange={setCustom} onPresetChange={setPreset} preset={preset} range={range} />
        </div>
        {canUpdate && <SyncButton />}
      </div>
      <div className="flex flex-col gap-6 px-4 lg:px-6">
        {stale && (
          <Alert>
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
            <AlertDescription>ข้อมูลค่าโฆษณาอาจไม่ครบ</AlertDescription>
          </Alert>
        )}
        {overview.isPending
          ? <QueryState kind="loading" />
          : overview.isError
            ? <QueryState kind="error" message={overview.error.message} onRetry={() => void overview.refetch()} />
            : (
              <>
                {overview.data.warnings.map((warning) => (
                  <Alert key={`${warning.code}-${warning.platform ?? ''}`}>
                    <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
                    <AlertDescription>{warningText(warning)}</AlertDescription>
                  </Alert>
                ))}
                <SummaryCards overview={overview.data} />
                <CampaignTable campaigns={overview.data.campaigns} />
              </>
            )}
        <MarginSetting canUpdate={canUpdate} />
        <UtmTemplates />
      </div>
    </>
  )
}
