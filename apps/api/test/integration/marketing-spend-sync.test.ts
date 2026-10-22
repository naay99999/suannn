import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { adSpendDaily, marketingSyncRun, trackingAlert } from '../../src/database/schema'
import { addDays, bangkokToday } from '../../src/modules/marketing/dates'
import { AdSpendAlerts } from '../../src/modules/marketing/spend/alerts'
import { AdSpendSync } from '../../src/modules/marketing/spend/sync'
import { SpendSyncError, type AdPlatform, type SpendRow, type SpendSource } from '../../src/modules/marketing/spend/types'
import { FakeEmailSender } from '../helpers/fakes'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined
const hour = 3_600_000

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

beforeEach(async () => {
  await database.db.delete(adSpendDaily)
  await database.db.delete(marketingSyncRun)
  await database.db.delete(trackingAlert)
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

function row(date: string, spendSatang = 1000, campaignId = 'c1'): SpendRow {
  return { accountId: 'acct', campaignId, campaignName: 'Campaign', date, spendSatang, currency: 'THB', impressions: 10, clicks: 2 }
}

function fakeSource(platform: AdPlatform, rows: () => SpendRow[] | Error, delayMs = 0) {
  const calls: Array<{ from: string, to: string }> = []
  const source: SpendSource = {
    platform,
    async fetch(range) {
      calls.push(range)
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
      const result = rows()
      if (result instanceof Error) throw result
      return { rows: result, accountTimezone: 'Asia/Bangkok' }
    },
  }
  return { source, calls }
}

describe('AdSpendSync', () => {
  it('backfills 90 days first, then re-syncs the last 3 days', async () => {
    const today = bangkokToday(new Date())
    const meta = fakeSource('meta', () => [row(today)])
    const sync = new AdSpendSync(database.db, { meta: meta.source })

    expect(await sync.run()).toEqual([{ platform: 'meta', status: 'succeeded' }])
    expect(meta.calls[0]).toEqual({ from: addDays(today, -89), to: today })

    await sync.run()
    expect(meta.calls[1]).toEqual({ from: addDays(today, -2), to: today })

    const [run] = await database.db.select().from(marketingSyncRun).where(eq(marketingSyncRun.status, 'succeeded')).limit(1)
    expect(run).toMatchObject({ platform: 'meta', rowsUpserted: 1, accountTimezone: 'Asia/Bangkok' })
    expect(run!.finishedAt).not.toBeNull()
  })

  it('overwrites a re-synced day without adding rows', async () => {
    const today = bangkokToday(new Date())
    let spend = 1000
    const meta = fakeSource('meta', () => [row(today, spend)])
    const sync = new AdSpendSync(database.db, { meta: meta.source })
    await sync.run()
    spend = 2500
    await sync.run()

    const rows = await database.db.select().from(adSpendDaily)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.spendSatang).toBe(2500)
  })

  it('records a typed failure without stopping other platforms', async () => {
    const today = bangkokToday(new Date())
    const meta = fakeSource('meta', () => new SpendSyncError('META_ADS_AUTH'))
    const tiktok = fakeSource('tiktok', () => [row(today)])
    const broken = fakeSource('google', () => new Error('secret-token-detail'))
    const sync = new AdSpendSync(database.db, { meta: meta.source, tiktok: tiktok.source, google: broken.source })

    expect(await sync.run()).toEqual([
      { platform: 'meta', status: 'failed', errorCode: 'META_ADS_AUTH' },
      { platform: 'tiktok', status: 'succeeded' },
      { platform: 'google', status: 'failed', errorCode: 'SPEND_SYNC_FAILED' },
    ])
    const runs = await database.db.select().from(marketingSyncRun)
    expect(runs.find(run => run.platform === 'meta')).toMatchObject({ status: 'failed', errorCode: 'META_ADS_AUTH' })
    expect(JSON.stringify(runs)).not.toContain('secret-token-detail')
  })

  it('reports not_configured without a run row', async () => {
    const sync = new AdSpendSync(database.db, {})
    expect(await sync.run({ platforms: ['meta'] })).toEqual([{ platform: 'meta', status: 'not_configured' }])
    expect(await database.db.select().from(marketingSyncRun)).toHaveLength(0)
  })

  it('refuses concurrent runs', async () => {
    const meta = fakeSource('meta', () => [row(bangkokToday(new Date()))], 50)
    const sync = new AdSpendSync(database.db, { meta: meta.source })
    const [first, second] = await Promise.all([sync.run(), sync.run()])

    expect(first).toEqual([{ platform: 'meta', status: 'succeeded' }])
    expect(second).toEqual([{ platform: 'meta', status: 'already_running' }])
    expect(meta.calls).toHaveLength(1)
  })

  it('is due when no configured platform ran in the last hour', async () => {
    let current = new Date()
    const meta = fakeSource('meta', () => [])
    const sync = new AdSpendSync(database.db, { meta: meta.source }, () => current)
    expect(await sync.due()).toBe(true)
    await sync.run()
    expect(await sync.due()).toBe(false)
    current = new Date(current.getTime() + 61 * 60 * 1000)
    expect(await sync.due()).toBe(true)
  })
})

describe('AdSpendAlerts', () => {
  async function insertRun(platform: AdPlatform, status: 'succeeded' | 'failed', startedAt: Date, errorCode: string | null = null) {
    await database.db.insert(marketingSyncRun).values({
      platform, status, startedAt, finishedAt: startedAt, errorCode, rangeFrom: '2026-10-01', rangeTo: '2026-10-03',
    })
  }

  function create(platforms: AdPlatform[] = ['meta'], to: string | null = 'owner@example.test') {
    const sender = new FakeEmailSender()
    return { sender, alerts: new AdSpendAlerts(database.db, platforms, to, sender, 'https://admin.example.test') }
  }

  it('alerts once when the last success is older than 6 hours', async () => {
    await insertRun('meta', 'succeeded', new Date(Date.now() - 7 * hour))
    await insertRun('meta', 'failed', new Date(Date.now() - hour), 'META_ADS_AUTH')
    const { alerts, sender } = create()

    await alerts.check()
    expect(sender.messages).toHaveLength(1)
    expect(sender.messages[0]).toMatchObject({ to: 'owner@example.test', subject: '[suannn] Ad spend sync failing: Meta' })
    expect(sender.messages[0]!.text).toContain('META_ADS_AUTH')
    expect(sender.messages[0]!.text).toContain('https://admin.example.test/settings')

    await alerts.check()
    expect(sender.messages).toHaveLength(1)
  })

  it('does not alert for a recent success, an unconfigured platform, or a platform that never ran', async () => {
    await insertRun('meta', 'succeeded', new Date(Date.now() - hour))
    await insertRun('tiktok', 'failed', new Date(Date.now() - 8 * hour), 'TIKTOK_HTTP_500')
    const { alerts, sender } = create(['meta', 'google'])
    await alerts.check()
    expect(sender.messages).toHaveLength(0)
  })

  it('does nothing without an alert email', async () => {
    await insertRun('meta', 'failed', new Date(Date.now() - 8 * hour), 'META_ADS_AUTH')
    const { alerts, sender } = create(['meta'], null)
    await alerts.check()
    expect(sender.messages).toHaveLength(0)
  })
})
