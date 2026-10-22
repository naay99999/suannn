import { eq, lt } from 'drizzle-orm'
import type { Database } from '../../../database/types'
import { trackingAlert } from '../../../database/schema'
import { logError } from '../../../shared/logger'
import type { EmailSender } from '../../email/sender'
import { adSpendAlertEmail } from '../../email/templates'
import { SpendRepository } from './repository'
import type { AdPlatform } from './types'

const hourMs = 60 * 60 * 1000
const staleAfterMs = 6 * hourMs
const dayMs = 24 * hourMs

const labels: Record<AdPlatform, string> = { meta: 'Meta', tiktok: 'TikTok', google: 'Google Ads' }

// Emails the owner when a configured ad platform has had no successful spend sync for 6 hours, at most once per platform per day.
export class AdSpendAlerts {
  private readonly repository: SpendRepository

  constructor(
    private readonly db: Database,
    private readonly configuredPlatforms: AdPlatform[],
    private readonly alertEmail: string | null,
    private readonly emailSender: EmailSender,
    private readonly adminUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.repository = new SpendRepository(db)
  }

  async check(): Promise<void> {
    const to = this.alertEmail
    if (!to) return

    for (const platform of this.configuredPlatforms) {
      try {
        const now = this.now()
        if (!(await this.repository.hasRun(platform))) continue
        const lastSuccessAt = await this.repository.lastSuccessAt(platform)
        if (lastSuccessAt && lastSuccessAt.getTime() >= now.getTime() - staleAfterMs) continue
        await this.alert(platform, to, await this.repository.lastErrorCode(platform), now)
      } catch (error) {
        logError({
          level: 'error', code: 'AD_SPEND_ALERT_FAILED', message: 'Ad spend alert check failed',
          platform, errorCategory: error instanceof Error ? error.name : 'UnknownError',
        })
      }
    }
  }

  private async alert(platform: AdPlatform, to: string, lastErrorCode: string | null, now: Date) {
    const key = `ad_spend:${platform}`
    const [previous] = await this.db.select({ lastSentAt: trackingAlert.lastSentAt }).from(trackingAlert)
      .where(eq(trackingAlert.destination, key))
    // Claim the throttle slot atomically so concurrent checks cannot both send.
    const claimed = await this.db.insert(trackingAlert).values({ destination: key, lastSentAt: now })
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
        ...adSpendAlertEmail(labels[platform], lastErrorCode, new URL('/settings', this.adminUrl).toString()),
      })
    } catch (error) {
      // Release the slot so the next check retries instead of staying silent for a day.
      if (previous) {
        await this.db.update(trackingAlert).set({ lastSentAt: previous.lastSentAt }).where(eq(trackingAlert.destination, key))
      } else {
        await this.db.delete(trackingAlert).where(eq(trackingAlert.destination, key))
      }
      throw error
    }
  }
}
