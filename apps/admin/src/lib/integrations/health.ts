import type { AdSpendStatus } from './api'

export const HOUR_MS = 60 * 60 * 1000
export const STALE_SYNC_MS = 6 * HOUR_MS

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function formatRelative(value: string, now: number) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 60) return relativeTime.format(seconds, 'second')
  if (abs < 3600) return relativeTime.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return relativeTime.format(Math.round(seconds / 3600), 'hour')
  return relativeTime.format(Math.round(seconds / 86_400), 'day')
}

export function adSpendHealth(row: AdSpendStatus, now: number) {
  if (!row.configured) return { label: 'Not configured', variant: 'secondary' } as const
  // Stale data is failing whatever the last run did, matching the Marketing page warning.
  const stale = !row.lastSuccessAt || now - new Date(row.lastSuccessAt).getTime() > STALE_SYNC_MS
  if (stale) return { label: 'Failing', variant: 'destructive' } as const
  if (row.lastRunStatus === 'failed') return { label: 'Degraded', variant: 'warning' } as const
  return { label: 'Healthy', variant: 'success' } as const
}

// Eden parses date-like strings into Date objects at runtime, despite the string type.
export function formatDateOnly(value: string) {
  return new Date(value).toISOString().slice(0, 10)
}
