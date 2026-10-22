import type { TrackingConfig } from '../../../config/env'
import { trackingConfigKeys, trackingDestinations, type TrackingDestination } from '../types'
import type { TrackingDestinationSummary, TrackingStatusRepository } from './repository'

export interface TrackingStatus {
  destinations: Array<{
    destination: TrackingDestination
    configured: boolean
    lastSuccessAt: string | null
    failures24h: number
    lastErrorCode: string | null
  }>
}

export class TrackingStatusService {
  constructor(
    private readonly repository: Pick<TrackingStatusRepository, 'summaries'>,
    private readonly tracking: TrackingConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(): Promise<TrackingStatus> {
    const summaries = new Map<TrackingDestination, TrackingDestinationSummary>(
      (await this.repository.summaries(this.now())).map((summary) => [summary.destination, summary]),
    )

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
    }
  }
}
