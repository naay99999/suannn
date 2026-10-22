import type { Database } from '../../../database/types'
import { logError } from '../../../shared/logger'
import { addDays, bangkokToday } from '../dates'
import { SpendRepository } from './repository'
import { adPlatforms, SpendSyncError, type AdPlatform, type SpendSource } from './types'

const backfillDays = 90
const resyncDays = 3
const dueAfterMs = 60 * 60 * 1000

export interface SpendSyncResult {
  platform: AdPlatform
  status: 'succeeded' | 'failed' | 'already_running' | 'not_configured'
  errorCode?: string
}

export class AdSpendSync {
  private readonly repository: SpendRepository
  private running = false

  constructor(
    db: Database,
    private readonly sources: Partial<Record<AdPlatform, SpendSource>>,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.repository = new SpendRepository(db)
  }

  async run(options: { platforms?: AdPlatform[] } = {}): Promise<SpendSyncResult[]> {
    const platforms = options.platforms ?? adPlatforms.filter(platform => this.sources[platform])
    if (this.running) return platforms.map(platform => ({ platform, status: 'already_running' as const }))

    this.running = true
    try {
      const results: SpendSyncResult[] = []
      for (const platform of platforms) results.push(await this.syncPlatform(platform))
      return results
    } finally {
      this.running = false
    }
  }

  // Due when no configured platform has started a run in the last hour.
  async due(): Promise<boolean> {
    const configured = adPlatforms.filter(platform => this.sources[platform])
    return configured.length > 0
      && !(await this.repository.hasRunSince(configured, new Date(this.now().getTime() - dueAfterMs)))
  }

  private async syncPlatform(platform: AdPlatform): Promise<SpendSyncResult> {
    const source = this.sources[platform]
    if (!source) return { platform, status: 'not_configured' }

    const startedAt = this.now()
    const today = bangkokToday(startedAt)
    const first = !(await this.repository.hasSpend(platform))
    const range = { from: addDays(today, first ? -(backfillDays - 1) : -(resyncDays - 1)), to: today }
    const runId = await this.repository.startRun(platform, range, startedAt)

    try {
      const { rows, accountTimezone } = await source.fetch(range)
      const rowsUpserted = await this.repository.upsertRows(platform, rows, this.now())
      await this.repository.finishRun(runId, { status: 'succeeded', rowsUpserted, accountTimezone }, this.now())
      return { platform, status: 'succeeded' }
    } catch (error) {
      const errorCode = error instanceof SpendSyncError ? error.code : 'SPEND_SYNC_FAILED'
      logError({ level: 'error', code: errorCode, message: 'Ad spend sync failed', platform })
      await this.repository.finishRun(runId, { status: 'failed', errorCode }, this.now()).catch(() => undefined)
      return { platform, status: 'failed', errorCode }
    }
  }
}
