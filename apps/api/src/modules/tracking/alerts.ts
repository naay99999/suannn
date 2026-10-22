import { and, count, desc, eq, gt, isNotNull, lt, max, notInArray } from 'drizzle-orm'
import type { TrackingConfig } from '../../config/env'
import type { Database } from '../../database/types'
import { trackingAlert, trackingOutbox } from '../../database/schema'
import { logError } from '../../shared/logger'
import type { EmailSender } from '../email/sender'
import { trackingAlertEmail } from '../email/templates'
import {
  trackingConfigKeys,
  trackingDestinationLabels,
  trackingDestinations,
  type TrackingDestination,
} from './types'

const failureThreshold = 5
const hourMs = 60 * 60 * 1000
const dayMs = 24 * hourMs

// Emails the owner when a configured destination keeps failing, at most once per destination per day.
export class TrackingAlerts {
  constructor(
    private readonly db: Database,
    private readonly tracking: TrackingConfig,
    private readonly emailSender: EmailSender,
    private readonly adminUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async check(): Promise<void> {
    const to = this.tracking.alertEmail
    if (!to) return

    for (const destination of trackingDestinations) {
      if (this.tracking[trackingConfigKeys[destination]] === null) continue
      try {
        const now = this.now()
        const lastErrorCode = await this.failing(destination, now)
        if (lastErrorCode === undefined) continue
        await this.alert(destination, to, lastErrorCode, now)
      } catch (error) {
        logError({
          level: 'error', code: 'TRACKING_ALERT_FAILED', message: 'Tracking alert check failed',
          destination, errorCategory: error instanceof Error ? error.name : 'UnknownError',
        })
      }
    }
  }

  // Returns the latest error code (possibly null) when the destination is failing, undefined when healthy.
  private async failing(destination: TrackingDestination, now: Date): Promise<string | null | undefined> {
    const [latest] = await this.db.select({ sentAt: max(trackingOutbox.sentAt) }).from(trackingOutbox)
      .where(eq(trackingOutbox.destination, destination))
    const lastSentAt = latest?.sentAt ?? null

    const [failures] = await this.db.select({ total: count() }).from(trackingOutbox).where(and(
      eq(trackingOutbox.destination, destination),
      isNotNull(trackingOutbox.lastFailedAt),
      lastSentAt ? gt(trackingOutbox.lastFailedAt, lastSentAt) : undefined,
    ))
    let failing = (failures?.total ?? 0) >= failureThreshold

    if (!failing && (!lastSentAt || lastSentAt.getTime() < now.getTime() - dayMs)) {
      const [stale] = await this.db.select({ total: count() }).from(trackingOutbox).where(and(
        eq(trackingOutbox.destination, destination),
        lt(trackingOutbox.createdAt, new Date(now.getTime() - hourMs)),
        notInArray(trackingOutbox.status, ['sent', 'skipped']),
      ))
      failing = (stale?.total ?? 0) > 0
    }
    if (!failing) return undefined

    const [row] = await this.db.select({ code: trackingOutbox.lastErrorCode }).from(trackingOutbox)
      .where(and(eq(trackingOutbox.destination, destination), isNotNull(trackingOutbox.lastFailedAt)))
      .orderBy(desc(trackingOutbox.lastFailedAt)).limit(1)
    return row?.code ?? null
  }

  private async alert(destination: TrackingDestination, to: string, lastErrorCode: string | null, now: Date) {
    const [previous] = await this.db.select({ lastSentAt: trackingAlert.lastSentAt }).from(trackingAlert)
      .where(eq(trackingAlert.destination, destination))
    // Claim the throttle slot atomically so concurrent checks cannot both send.
    const claimed = await this.db.insert(trackingAlert).values({ destination, lastSentAt: now })
      .onConflictDoUpdate({
        target: trackingAlert.destination,
        set: { lastSentAt: now },
        setWhere: lt(trackingAlert.lastSentAt, new Date(now.getTime() - dayMs)),
      })
      .returning({ destination: trackingAlert.destination })
    if (claimed.length === 0) return

    try {
      await this.emailSender.send({
        to,
        template: 'tracking-alert',
        ...trackingAlertEmail(trackingDestinationLabels[destination], lastErrorCode, new URL('/settings', this.adminUrl).toString()),
      })
    } catch (error) {
      // Release the slot so the next check retries instead of staying silent for a day.
      if (previous) {
        await this.db.update(trackingAlert).set({ lastSentAt: previous.lastSentAt }).where(eq(trackingAlert.destination, destination))
      } else {
        await this.db.delete(trackingAlert).where(eq(trackingAlert.destination, destination))
      }
      throw error
    }
  }
}
