import type { TrackingConfig } from '../../../config/env'
import { trackingConfigKeys, trackingDestinations, type TrackingDestination } from '../types'
import { adPlatforms, type AdPlatform } from '../../marketing/spend/types'
import type { AdSpendSummary, TrackingDestinationSummary, TrackingStatusRepository } from './repository'

export interface TrackingStatus {
  destinations: Array<{
    destination: TrackingDestination
    configured: boolean
    lastSuccessAt: string | null
    failures24h: number
    lastErrorCode: string | null
  }>
  adSpend: Array<{
    platform: AdPlatform
    configured: boolean
    lastSuccessAt: string | null
    lastRunStatus: 'succeeded' | 'failed' | 'running' | null
    lastErrorCode: string | null
    earliestDate: string | null
  }>
}

// A run still marked running after this long is treated as failed for display only.
const STALE_RUN_MS = 60 * 60 * 1000
const STALE_RUN_ERROR_CODE = 'SPEND_SYNC_STALE_RUN'

export class TrackingStatusService {
  constructor(
    private readonly repository: Pick<TrackingStatusRepository, 'summaries' | 'adSpendSummaries'>,
    private readonly tracking: TrackingConfig,
    private readonly configuredAdPlatforms: readonly AdPlatform[] = [],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(): Promise<TrackingStatus> {
    const now = this.now()
    const [destinationRows, adSpendRows] = await Promise.all([this.repository.summaries(now), this.repository.adSpendSummaries()])
    const summaries = new Map<TrackingDestination, TrackingDestinationSummary>(
      destinationRows.map((summary) => [summary.destination, summary]),
    )
    const adSpend = new Map<AdPlatform, AdSpendSummary>(adSpendRows.map((summary) => [summary.platform, summary]))

    return {
      destinations: trackingDestinations.map((destination) => {
        const summary = summaries.get(destination)
        return {
          destination,
          configured: this.tracking[trackingConfigKeys[destination]] !== null,
          lastSuccessAt: summary?.lastSuccessAt?.toISOString() ?? null,
          failures24h: summary?.failures24h ?? 0,
          lastErrorCode: summary?.lastErrorCode ?? null,
        }
      }),
      adSpend: adPlatforms.map((platform) => {
        const summary = adSpend.get(platform)
        const run = summary?.latestRun ?? null
        const stuck = run?.status === 'running' && now.getTime() - run.startedAt.getTime() > STALE_RUN_MS
        return {
          platform,
          configured: this.configuredAdPlatforms.includes(platform),
          lastSuccessAt: summary?.lastSuccessAt?.toISOString() ?? null,
          lastRunStatus: stuck ? 'failed' as const : run?.status ?? null,
          lastErrorCode: stuck ? STALE_RUN_ERROR_CODE : summary?.lastFailedErrorCode ?? null,
          earliestDate: summary?.earliestDate ?? null,
        }
      }),
    }
  }
}
