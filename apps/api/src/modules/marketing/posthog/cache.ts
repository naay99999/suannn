import type { DateRange } from '../dates'
import { createPostHogReadClient, type PostHogReadConfig } from './client'
import { getExperiments, type ExperimentSummary } from './experiments'
import { getFunnel, type FunnelFilter, type FunnelStep } from './funnel'

const TEN_MINUTES_MS = 10 * 60 * 1000

export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T, expiresAt: number }>()

  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  // Only successful loads are stored, so a failure is retried on the next call.
  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key)
    if (hit && hit.expiresAt > this.now()) return hit.value
    const value = await load()
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
    return value
  }
}

export interface MarketingPostHog {
  funnel(range: DateRange, filter: FunnelFilter): Promise<{ steps: FunnelStep[] }>
  experiments(): Promise<{ experiments: ExperimentSummary[] }>
}

export function createCachedPostHog(
  config: PostHogReadConfig,
  options: { fetchImpl?: typeof fetch, now?: () => number } = {},
): MarketingPostHog {
  const client = createPostHogReadClient(config, options.fetchImpl)
  const funnels = new TtlCache<{ steps: FunnelStep[] }>(TEN_MINUTES_MS, options.now)
  const experiments = new TtlCache<{ experiments: ExperimentSummary[] }>(TEN_MINUTES_MS, options.now)
  return {
    funnel: (range, filter) => funnels.get(
      `funnel:${config.projectId}:${range.from}:${range.to}:${filter.platform ?? ''}:${filter.campaign ?? ''}`,
      () => getFunnel(client, range, filter),
    ),
    experiments: () => experiments.get(`experiments:${config.projectId}`, () => getExperiments(client)),
  }
}
