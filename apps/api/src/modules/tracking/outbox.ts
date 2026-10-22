import { and, asc, eq, inArray, lte, or, sql, lt } from 'drizzle-orm'
import type { Database } from '../../database/types'
import { trackingOutbox } from '../../database/schema'
import { logError } from '../../shared/logger'
import { loadPurchaseEvent } from './purchase'
import { TrackingDeliveryError, type TrackingAdapter, type TrackingDestination } from './types'

const maximumBatchSize = 100
const initialRetryDelayMs = 30 * 1000
const maximumRetryDelayMs = 6 * 60 * 60 * 1000

interface ClaimedRow {
  id: string
  orderId: string
  destination: TrackingDestination
  attemptCount: number
  expiresAt: Date
}

function retryDelayMs(attemptCount: number) {
  const exponent = Math.max(0, attemptCount - 1)
  if (exponent >= 32) return maximumRetryDelayMs
  return Math.min(initialRetryDelayMs * 2 ** exponent, maximumRetryDelayMs)
}

export class TrackingOutbox {
  constructor(
    private readonly db: Database,
    private readonly adapters: Partial<Record<TrackingDestination, TrackingAdapter>>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async processBatch(limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('INVALID_OUTBOX_BATCH_LIMIT')
    const claimed = await this.claimDueRows(Math.min(limit, maximumBatchSize))

    for (const row of claimed) await this.deliver(row)
    return claimed.length
  }

  private claimDueRows(limit: number): Promise<ClaimedRow[]> {
    return this.db.transaction(async (tx) => {
      const due = await tx.select({ id: trackingOutbox.id })
        .from(trackingOutbox)
        .where(or(
          and(
            inArray(trackingOutbox.status, ['pending', 'failed']),
            lte(trackingOutbox.nextAttemptAt, sql`transaction_timestamp()`),
          ),
          and(
            eq(trackingOutbox.status, 'processing'),
            lt(trackingOutbox.claimedAt, sql`transaction_timestamp() - interval '5 minutes'`),
          ),
        ))
        .orderBy(asc(trackingOutbox.nextAttemptAt), asc(trackingOutbox.createdAt), asc(trackingOutbox.id))
        .for('update', { skipLocked: true })
        .limit(limit)
      const ids = due.map(({ id }) => id)
      if (ids.length === 0) return []
      return tx.update(trackingOutbox).set({
        status: 'processing',
        attemptCount: sql`${trackingOutbox.attemptCount} + 1`,
        claimedAt: sql`transaction_timestamp()`,
      }).where(inArray(trackingOutbox.id, ids)).returning({
        id: trackingOutbox.id,
        orderId: trackingOutbox.orderId,
        destination: trackingOutbox.destination,
        attemptCount: trackingOutbox.attemptCount,
        expiresAt: trackingOutbox.expiresAt,
      })
    })
  }

  private async deliver(row: ClaimedRow) {
    const [activeClaim] = await this.db.select({ id: trackingOutbox.id })
      .from(trackingOutbox)
      .where(and(
        eq(trackingOutbox.id, row.id),
        eq(trackingOutbox.status, 'processing'),
        eq(trackingOutbox.attemptCount, row.attemptCount),
      )).limit(1)
    if (!activeClaim) return

    const adapter = this.adapters[row.destination]
    if (!adapter) {
      await this.finish(row, { status: 'skipped' })
      return
    }

    if (this.now().getTime() > row.expiresAt.getTime()) {
      await this.finish(row, { status: 'expired', lastErrorCode: 'EVENT_TOO_OLD' })
      return
    }

    try {
      const event = await loadPurchaseEvent(this.db, row.orderId)
      if (!event) throw new TrackingDeliveryError('EVENT_UNAVAILABLE', false)
      await adapter.send(event)
      await this.finish(row, { status: 'sent', sentAt: this.now(), lastErrorCode: null })
    } catch (error) {
      const known = error instanceof TrackingDeliveryError
      await this.markFailed(row, known ? error.code : 'DELIVERY_FAILED', known && !error.retryable)
    }
  }

  private async finish(row: ClaimedRow, values: Partial<typeof trackingOutbox.$inferInsert>) {
    await this.db.update(trackingOutbox).set({ ...values, claimedAt: null }).where(and(
      eq(trackingOutbox.id, row.id),
      eq(trackingOutbox.status, 'processing'),
      eq(trackingOutbox.attemptCount, row.attemptCount),
    ))
  }

  // A non-retryable failure is rescheduled at expiresAt, so the next claim expires it.
  private async markFailed(row: ClaimedRow, errorCode: string, terminal: boolean) {
    const now = this.now()
    await this.finish(row, {
      status: 'failed',
      lastFailedAt: now,
      lastErrorCode: errorCode,
      nextAttemptAt: terminal ? row.expiresAt : new Date(now.getTime() + retryDelayMs(row.attemptCount)),
    })
    logError({
      level: 'error',
      code: errorCode,
      message: 'Tracking delivery failed',
      destination: row.destination,
      attemptCount: row.attemptCount,
    })
  }
}
