import { eq, isNotNull, max, min, sql } from 'drizzle-orm'
import type { Database } from '../../../database/types'
import { adSpendDaily, marketingSyncRun, trackingOutbox } from '../../../database/schema'
import type { AdPlatform } from '../../marketing/spend/types'
import type { TrackingDestination } from '../types'

export interface TrackingDestinationSummary {
  destination: TrackingDestination
  lastSuccessAt: Date | null
  failures24h: number
  lastErrorCode: string | null
}

export interface AdSpendSummary {
  platform: AdPlatform
  latestRun: { status: 'running' | 'succeeded' | 'failed', startedAt: Date, errorCode: string | null } | null
  lastSuccessAt: Date | null
  lastFailedErrorCode: string | null
  earliestDate: string | null
}

export class TrackingStatusRepository {
  constructor(private readonly db: Database) {}

  async summaries(now: Date): Promise<TrackingDestinationSummary[]> {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const totals = await this.db.select({
      destination: trackingOutbox.destination,
      lastSuccessAt: max(trackingOutbox.sentAt),
      failures24h: sql<number>`count(*) filter (where ${trackingOutbox.lastFailedAt} > ${since.toISOString()}::timestamptz)`.mapWith(Number),
    }).from(trackingOutbox).groupBy(trackingOutbox.destination)

    const errors = await this.db.selectDistinctOn([trackingOutbox.destination], {
      destination: trackingOutbox.destination,
      lastErrorCode: trackingOutbox.lastErrorCode,
    }).from(trackingOutbox)
      .where(isNotNull(trackingOutbox.lastFailedAt))
      .orderBy(trackingOutbox.destination, sql`${trackingOutbox.lastFailedAt} desc`)

    const errorByDestination = new Map(errors.map(({ destination, lastErrorCode }) => [destination, lastErrorCode]))
    return totals.map(({ destination, lastSuccessAt, failures24h }) => ({
      destination,
      lastSuccessAt: lastSuccessAt ?? null,
      failures24h,
      lastErrorCode: errorByDestination.get(destination) ?? null,
    }))
  }

  async adSpendSummaries(): Promise<AdSpendSummary[]> {
    const latest = await this.db.selectDistinctOn([marketingSyncRun.platform], {
      platform: marketingSyncRun.platform,
      status: marketingSyncRun.status,
      startedAt: marketingSyncRun.startedAt,
      errorCode: marketingSyncRun.errorCode,
    }).from(marketingSyncRun).orderBy(marketingSyncRun.platform, sql`${marketingSyncRun.startedAt} desc`)

    const successes = await this.db.select({
      platform: marketingSyncRun.platform,
      lastSuccessAt: max(marketingSyncRun.finishedAt),
    }).from(marketingSyncRun).where(eq(marketingSyncRun.status, 'succeeded')).groupBy(marketingSyncRun.platform)

    const failures = await this.db.selectDistinctOn([marketingSyncRun.platform], {
      platform: marketingSyncRun.platform,
      errorCode: marketingSyncRun.errorCode,
    }).from(marketingSyncRun).where(eq(marketingSyncRun.status, 'failed'))
      .orderBy(marketingSyncRun.platform, sql`${marketingSyncRun.startedAt} desc`)

    const earliest = await this.db.select({
      platform: adSpendDaily.platform,
      earliestDate: min(adSpendDaily.date),
    }).from(adSpendDaily).groupBy(adSpendDaily.platform)

    const platforms = new Set<AdPlatform>([...latest, ...successes, ...failures, ...earliest].map(({ platform }) => platform))
    return [...platforms].map((platform) => {
      const run = latest.find((row) => row.platform === platform)
      return {
        platform,
        latestRun: run ? { status: run.status, startedAt: run.startedAt, errorCode: run.errorCode } : null,
        lastSuccessAt: successes.find((row) => row.platform === platform)?.lastSuccessAt ?? null,
        lastFailedErrorCode: failures.find((row) => row.platform === platform)?.errorCode ?? null,
        earliestDate: earliest.find((row) => row.platform === platform)?.earliestDate ?? null,
      }
    })
  }
}
