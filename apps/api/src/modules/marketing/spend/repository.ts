import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { Database } from '../../../database/types'
import { adSpendDaily, marketingSyncRun } from '../../../database/schema'
import type { AdPlatform, SpendRow } from './types'

const upsertBatchSize = 500

export class SpendRepository {
  constructor(private readonly db: Database) {}

  async hasSpend(platform: AdPlatform): Promise<boolean> {
    const [found] = await this.db.select({ platform: adSpendDaily.platform }).from(adSpendDaily)
      .where(eq(adSpendDaily.platform, platform)).limit(1)
    return Boolean(found)
  }

  async startRun(platform: AdPlatform, range: { from: string, to: string }, startedAt: Date): Promise<string> {
    const [created] = await this.db.insert(marketingSyncRun)
      .values({ platform, status: 'running', startedAt, rangeFrom: range.from, rangeTo: range.to })
      .returning({ id: marketingSyncRun.id })
    return created!.id
  }

  // All rows of one platform run land together or not at all.
  async upsertRows(platform: AdPlatform, rows: SpendRow[], syncedAt: Date): Promise<number> {
    if (rows.length === 0) return 0
    await this.db.transaction(async (tx) => {
      for (let index = 0; index < rows.length; index += upsertBatchSize) {
        await tx.insert(adSpendDaily)
          .values(rows.slice(index, index + upsertBatchSize).map(row => ({ ...row, platform, syncedAt })))
          .onConflictDoUpdate({
            target: [adSpendDaily.platform, adSpendDaily.accountId, adSpendDaily.campaignId, adSpendDaily.date],
            set: {
              campaignName: sql`excluded.campaign_name`,
              spendSatang: sql`excluded.spend_satang`,
              currency: sql`excluded.currency`,
              impressions: sql`excluded.impressions`,
              clicks: sql`excluded.clicks`,
              syncedAt: sql`excluded.synced_at`,
            },
          })
      }
    })
    return rows.length
  }

  async finishRun(
    id: string,
    result: { status: 'succeeded', rowsUpserted: number, accountTimezone: string | null } | { status: 'failed', errorCode: string },
    finishedAt: Date,
  ): Promise<void> {
    await this.db.update(marketingSyncRun).set({ ...result, finishedAt }).where(eq(marketingSyncRun.id, id))
  }

  async hasRunSince(platforms: AdPlatform[], since: Date): Promise<boolean> {
    if (platforms.length === 0) return false
    const [found] = await this.db.select({ id: marketingSyncRun.id }).from(marketingSyncRun)
      .where(and(inArray(marketingSyncRun.platform, platforms), gt(marketingSyncRun.startedAt, since))).limit(1)
    return Boolean(found)
  }

  async lastSuccessAt(platform: AdPlatform): Promise<Date | null> {
    const [latest] = await this.db.select({ at: marketingSyncRun.finishedAt }).from(marketingSyncRun)
      .where(and(eq(marketingSyncRun.platform, platform), eq(marketingSyncRun.status, 'succeeded')))
      .orderBy(desc(marketingSyncRun.finishedAt)).limit(1)
    return latest?.at ?? null
  }

  async hasRun(platform: AdPlatform): Promise<boolean> {
    const [found] = await this.db.select({ id: marketingSyncRun.id }).from(marketingSyncRun)
      .where(eq(marketingSyncRun.platform, platform)).limit(1)
    return Boolean(found)
  }

  async lastErrorCode(platform: AdPlatform): Promise<string | null> {
    const [latest] = await this.db.select({ code: marketingSyncRun.errorCode }).from(marketingSyncRun)
      .where(and(eq(marketingSyncRun.platform, platform), eq(marketingSyncRun.status, 'failed')))
      .orderBy(desc(marketingSyncRun.startedAt)).limit(1)
    return latest?.code ?? null
  }
}
