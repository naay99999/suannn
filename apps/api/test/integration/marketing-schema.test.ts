import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from '../helpers/database'

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

async function expectRejects(query: () => Promise<unknown>, code: string) {
  const error = await query().then(() => undefined, (cause: unknown) => cause)
  expect((error as { code?: string } | undefined)?.code).toBe(code)
}

function insertSpend(platform: string, campaignId: string, spendSatang = 100, date = '2026-10-20') {
  return database.client.unsafe(`
    insert into ad_spend_daily (platform, account_id, campaign_id, campaign_name, date, spend_satang, currency, synced_at)
    values ($1, 'acct-1', $2, 'Campaign', $3, $4, 'THB', now())
  `, [platform, campaignId, date, spendSatang])
}

describe('marketing schema constraints', () => {
  it('rejects a duplicate (platform, account, campaign, date) spend row', async () => {
    await insertSpend('meta', 'c-dup')
    await expectRejects(() => insertSpend('meta', 'c-dup'), '23505')
    await insertSpend('meta', 'c-dup', 100, '2026-10-21')
    await insertSpend('tiktok', 'c-dup')
  })

  it('rejects an unknown platform and negative spend', async () => {
    await expectRejects(() => insertSpend('ga4', 'c-bad-platform'), '23514')
    await expectRejects(() => insertSpend('meta', 'c-negative', -1), '23514')
  })

  it('defaults impressions and clicks to zero', async () => {
    await insertSpend('google', 'c-defaults')
    const rows = await database.client.unsafe<{ impressions: string; clicks: string }[]>(
      `select impressions, clicks from ad_spend_daily where campaign_id = 'c-defaults'`)
    expect(rows[0]).toEqual({ impressions: '0', clicks: '0' })
  })

  it('validates sync run platform and status and defaults rows_upserted', async () => {
    const insertRun = (platform: string, status: string) => database.client.unsafe(`
      insert into marketing_sync_run (platform, status, range_from, range_to)
      values ($1, $2, '2026-10-19', '2026-10-21')
    `, [platform, status])
    await expectRejects(() => insertRun('ga4', 'running'), '23514')
    await expectRejects(() => insertRun('meta', 'done'), '23514')
    await insertRun('meta', 'running')
    const rows = await database.client.unsafe<{ rows_upserted: number }[]>(
      `select rows_upserted from marketing_sync_run`)
    expect(rows[0]?.rows_upserted).toBe(0)
  })

  it('seeds a single settings row with the default margin', async () => {
    const rows = await database.client.unsafe<{ id: number; margin_percent: string; version: number }[]>(
      `select id, margin_percent, version from marketing_settings`)
    expect([...rows]).toEqual([{ id: 1, margin_percent: '35.0', version: 1 }])
  })

  it('rejects a second settings row and out-of-range margins', async () => {
    await expectRejects(() => database.client.unsafe(`insert into marketing_settings (id) values (2)`), '23514')
    await expectRejects(() => database.client.unsafe(`update marketing_settings set margin_percent = 0`), '23514')
    await expectRejects(() => database.client.unsafe(`update marketing_settings set margin_percent = 100.1`), '23514')
  })
})
