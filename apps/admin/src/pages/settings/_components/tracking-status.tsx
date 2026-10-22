import { useQuery } from '@tanstack/react-query'
import { Badge } from '@workspace/ui/components/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { QueryState } from '@/components/query-state'
import { formatTimestamp } from '@/lib/format'
import type { AdSpendStatus, TrackingDestinationStatus } from '@/lib/integrations/api'
import { adSpendHealth, formatDateOnly, formatRelative } from '@/lib/integrations/health'
import { trackingStatusQuery } from '@/lib/integrations/queries'

const labels: Record<TrackingDestinationStatus['destination'], string> = {
  posthog: 'PostHog',
  meta: 'Meta',
  tiktok: 'TikTok',
  google_ads: 'Google Ads',
}

const adSpendLabels: Record<AdSpendStatus['platform'], string> = {
  meta: 'Meta',
  tiktok: 'TikTok',
  google: 'Google Ads',
}

const DAY_MS = 24 * 60 * 60 * 1000
function health(row: TrackingDestinationStatus, now: number) {
  if (!row.configured) return { label: 'Not configured', variant: 'secondary' } as const
  if (row.failures24h > 0) {
    // The API gives no failure time, so a success older than 24 h cannot postdate the failures.
    const stale = !row.lastSuccessAt || now - new Date(row.lastSuccessAt).getTime() > DAY_MS
    return stale ? { label: 'Failing', variant: 'destructive' } as const : { label: 'Degraded', variant: 'warning' } as const
  }
  return { label: 'Healthy', variant: 'success' } as const
}

export function TrackingStatus() {
  const status = useQuery(trackingStatusQuery)
  const now = Date.now()

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Tracking delivery</CardTitle>
          <CardDescription>Server-side purchase events sent to each destination.</CardDescription>
        </CardHeader>
        <CardContent>
          {status.isPending ? <QueryState kind="loading" />
            : !status.data ? <QueryState kind="error" message="โหลดสถานะการติดตามไม่สำเร็จ" onRetry={() => void status.refetch()} />
              : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Destination</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last success</TableHead>
                      <TableHead>Failures (24 h)</TableHead>
                      <TableHead>Last error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.data.destinations.map((row) => {
                      const state = health(row, now)
                      return (
                        <TableRow key={row.destination}>
                          <TableCell className="font-medium">{labels[row.destination]}</TableCell>
                          <TableCell><Badge variant={state.variant}>{state.label}</Badge></TableCell>
                          <TableCell title={row.lastSuccessAt ? formatTimestamp(row.lastSuccessAt) : undefined}>
                            {row.lastSuccessAt ? formatRelative(row.lastSuccessAt, now) : 'Never'}
                          </TableCell>
                          <TableCell>{row.failures24h}</TableCell>
                          <TableCell>{row.lastErrorCode ?? '-'}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ad spend sync</CardTitle>
          <CardDescription>Hourly import of campaign spend from each ad platform.</CardDescription>
        </CardHeader>
        <CardContent>
          {status.isPending ? <QueryState kind="loading" />
            : !status.data ? <QueryState kind="error" message="โหลดสถานะการซิงก์ค่าโฆษณาไม่สำเร็จ" onRetry={() => void status.refetch()} />
              : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Platform</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last success</TableHead>
                      <TableHead>Earliest data</TableHead>
                      <TableHead>Last error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.data.adSpend.map((row) => {
                      const state = adSpendHealth(row, now)
                      return (
                        <TableRow key={row.platform}>
                          <TableCell className="font-medium">{adSpendLabels[row.platform]}</TableCell>
                          <TableCell><Badge variant={state.variant}>{state.label}</Badge></TableCell>
                          <TableCell title={row.lastSuccessAt ? formatTimestamp(row.lastSuccessAt) : undefined}>
                            {row.lastSuccessAt ? formatRelative(row.lastSuccessAt, now) : 'Never'}
                          </TableCell>
                          <TableCell>{row.earliestDate ? formatDateOnly(row.earliestDate) : '-'}</TableCell>
                          <TableCell>{row.lastErrorCode ?? '-'}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
        </CardContent>
      </Card>
    </div>
  )
}
