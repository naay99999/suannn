import { DomainError } from '../../../shared/domain-error'
import type { DateRange } from '../dates'
import { PLATFORM_SOURCE_ALIASES } from '../metrics/attribution'
import type { AdPlatform } from '../spend/types'
import type { PostHogReadClient } from './client'

export interface FunnelFilter {
  platform?: AdPlatform
  campaign?: string
}

export interface FunnelStep {
  event: string
  label: string
  count: number
  conversionFromPrevious: number | null
  dropOffFromPrevious: number | null
}

const STEPS = [
  { event: '$pageview', label: 'เข้าเว็บ' },
  { event: 'view_item', label: 'ดูสินค้า' },
  { event: 'add_to_cart', label: 'ใส่ตะกร้า' },
  { event: 'begin_checkout', label: 'เริ่มชำระเงิน' },
  { event: 'purchase', label: 'ซื้อสำเร็จ' },
] as const

// Request shape follows PostHog's Query API (POST /api/projects/:id/query/ with a FunnelsQuery) and its
// documented response `{ results: [{ order, count, name, ... }] }`. Written from the public docs and not
// verified against a live project; an unexpected response is rejected rather than guessed at.
// Timezone: dateRange boundaries carry an explicit +07:00 offset so the window is Bangkok days regardless
// of the PostHog project's own timezone setting.
function buildQuery(range: DateRange, filter: FunnelFilter) {
  const properties: Array<{ type: 'event', key: string, operator: 'exact' | 'regex', value: string[] | string }> = []
  if (filter.platform) {
    // Exact matching is case-sensitive in PostHog; attribution lowercases utm_source, so match case-insensitively.
    const aliases = PLATFORM_SOURCE_ALIASES[filter.platform].map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    properties.push({ type: 'event', key: 'utm_source', operator: 'regex', value: `(?i)^(${aliases.join('|')})$` })
  }
  if (filter.campaign) properties.push({ type: 'event', key: 'utm_campaign', operator: 'exact', value: [filter.campaign] })
  return {
    kind: 'FunnelsQuery',
    series: STEPS.map(step => ({ kind: 'EventsNode', event: step.event, name: step.event })),
    dateRange: { date_from: `${range.from}T00:00:00+07:00`, date_to: `${range.to}T23:59:59+07:00` },
    funnelsFilter: { funnelWindowInterval: 1, funnelWindowIntervalUnit: 'day', funnelVizType: 'steps' },
    properties,
  }
}

export async function getFunnel(
  client: PostHogReadClient,
  range: DateRange,
  filter: FunnelFilter,
): Promise<{ steps: FunnelStep[] }> {
  const response = await client.query({ query: buildQuery(range, filter) }) as { results?: unknown } | null
  const results = response?.results
  if (!Array.isArray(results) || results.length !== STEPS.length) throw new DomainError('POSTHOG_READ_REJECTED')
  const counts = results.map((row) => {
    const count = (row as { count?: unknown } | null)?.count
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) throw new DomainError('POSTHOG_READ_REJECTED')
    return count
  })
  return {
    steps: STEPS.map((step, index) => {
      const previous = index === 0 ? 0 : counts[index - 1]!
      const conversion = index > 0 && previous > 0 ? counts[index]! / previous : null
      return {
        ...step,
        count: counts[index]!,
        conversionFromPrevious: conversion,
        dropOffFromPrevious: conversion === null ? null : 1 - conversion,
      }
    }),
  }
}
