import type { DateRange } from '../dates'
import { createPostHogReadClient, type PostHogReadConfig } from './client'
import { getExperiments, type ExperimentSummary } from './experiments'
import { getFunnel, type FunnelFilter, type FunnelStep } from './funnel'

const TEN_MINUTES_MS = 10 * 60 * 1000

const MAX_ENTRIES = 200

export class TtlCache<T> {
  private readonly entries = new Map<string, { promise: Promise<T>, expiresAt: number }>()

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = MAX_ENTRIES,
  ) {}

  // Concurrent callers share one in-flight load. A rejected load is dropped so it is retried on the next call.
  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key)
    if (hit && hit.expiresAt > this.now()) return hit.promise
    const now = this.now()
    for (const [entryKey, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(entryKey)
    }
    // Map iteration is insertion order, so the first key is the oldest.
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    const promise = load()
    const entry = { promise, expiresAt: now + this.ttlMs }
    this.entries.set(key, entry)
    promise.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
    })
    return promise
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
