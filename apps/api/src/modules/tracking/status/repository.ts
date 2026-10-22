import { isNotNull, max, sql } from 'drizzle-orm'
import type { Database } from '../../../database/types'
import { trackingOutbox } from '../../../database/schema'
import type { TrackingDestination } from '../types'

export interface TrackingDestinationSummary {
  destination: TrackingDestination
  lastSuccessAt: Date | null
  failures24h: number
  lastErrorCode: string | null
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
}
