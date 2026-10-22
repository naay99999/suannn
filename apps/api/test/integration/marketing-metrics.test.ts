import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { commerceOrder, inventoryReservation, warehouse } from '../../src/database/schema'
import { MarketingMetrics } from '../../src/modules/marketing/metrics/service'
import type { AdPlatform } from '../../src/modules/marketing/spend/types'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

type OrderStatus = typeof commerceOrder.$inferSelect['status']

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined
const day = { from: '2026-10-21', to: '2026-10-21' }

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
})

beforeEach(async () => {
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

function metrics(platforms: AdPlatform[] = ['meta', 'tiktok', 'google']) {
  return new MarketingMetrics(database.db, platforms)
}

async function insertOrder(input: {
  createdAt: string
  subtotalSatang: number
  status?: OrderStatus
  utm?: { source?: string | null, campaign?: string | null }
}) {
  const [mainWarehouse] = await database.db.select({ id: warehouse.id }).from(warehouse)
    .where(eq(warehouse.code, 'MAIN'))
  if (!mainWarehouse) throw new Error('Expected MAIN warehouse')
  const id = crypto.randomUUID()
  const reservationId = crypto.randomUUID()
  const created = new Date(input.createdAt)
  await database.db.insert(inventoryReservation).values({
    id: reservationId,
    warehouseId: mainWarehouse.id,
    status: 'confirmed',
    createdAt: created,
    expiresAt: new Date(created.getTime() + 86_400_000),
    completedAt: created,
    actorId: 'marketing-test',
  })
  await database.db.insert(commerceOrder).values({
    id,
    orderNumber: `MKT-${id.replaceAll('-', '')}`,
    customerId: null,
    guestAccessTokenHash: 'a'.repeat(64),
    guestAccessTokenNonce: `marketing-${id}`,
    guestAccessTokenVersion: 1,
    contactEmail: 'marketing@example.test',
    contactPhone: '081-234-5678',
    recipientName: 'Marketing Test',
    addressLine1: '1 Main Road',
    subdistrict: 'Talat Noi',
    district: 'Samphanthawong',
    province: 'Bangkok',
    postalCode: '10100',
    billingName: 'Marketing Test',
    billingPhone: '081-234-5678',
    billingAddressLine1: '1 Main Road',
    billingSubdistrict: 'Talat Noi',
    billingDistrict: 'Samphanthawong',
    billingProvince: 'Bangkok',
    billingPostalCode: '10100',
    subtotalSatang: input.subtotalSatang,
    shippingSatang: 0,
    totalSatang: input.subtotalSatang,
    status: input.status ?? 'placed',
    reservationId,
    quoteFingerprint: 'b'.repeat(64),
    createdAt: created,
    updatedAt: created,
  })
  if (input.utm) {
    await database.client.unsafe(`
      insert into order_attribution (order_id, analytics_consent, marketing_consent, utm_source, utm_campaign)
      values ($1, true, true, $2, $3)
    `, [id, input.utm.source ?? null, input.utm.campaign ?? null])
  }
  return id
}

function insertSpend(input: {
  platform: AdPlatform
  campaignId: string
  date: string
  spendSatang: number
  currency?: string
  name?: string | null
}) {
  return database.client.unsafe(`
    insert into ad_spend_daily (platform, account_id, campaign_id, campaign_name, date, spend_satang, currency, synced_at)
    values ($1, 'acct-1', $2, $3, $4, $5, $6, now())
  `, [input.platform, input.campaignId, input.name === undefined ? 'Campaign' : input.name, input.date, input.spendSatang, input.currency ?? 'THB'])
}

function insertRun(platform: AdPlatform, status: string, accountTimezone: string | null, startedAt: string) {
  return database.client.unsafe(`
    insert into marketing_sync_run (platform, status, range_from, range_to, account_timezone, started_at)
    values ($1, $2, '2026-10-01', '2026-10-21', $3, $4)
  `, [platform, status, accountTimezone, startedAt])
}

describe('marketing metrics overview', () => {
  it('filters orders by Bangkok day and valid status, and sums subtotal', async () => {
    await insertSpend({ platform: 'meta', campaignId: '123', date: '2026-10-21', spendSatang: 10000 })
    const utm = { source: 'facebook', campaign: '123' }
    await insertOrder({ createdAt: '2026-10-21T16:30:00Z', subtotalSatang: 20000, utm })
    await insertOrder({ createdAt: '2026-10-21T17:30:00Z', subtotalSatang: 99999, utm })
    await insertOrder({ createdAt: '2026-10-20T16:59:59Z', subtotalSatang: 88888, utm })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 11111, status: 'cancelled', utm })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 22222, status: 'pending_payment', utm })
    await insertOrder({ createdAt: '2026-10-21T06:00:00Z', subtotalSatang: 12000, status: 'delivered', utm })

    const overview = await metrics().overview(day, 35)

    expect(overview.summary).toMatchObject({ spendSatang: 10000, revenueSatang: 32000, orders: 2, roas: 3.2 })
    expect(overview.summary.costPerOrderSatang).toBe(5000)
    expect(overview.campaigns).toEqual([{
      platform: 'meta',
      utmSource: 'facebook',
      campaignId: '123',
      campaignName: 'Campaign',
      spendSatang: 10000,
      orders: 2,
      revenueSatang: 32000,
      roas: 3.2,
      costPerOrderSatang: 5000,
      verdict: 'profit',
    }])
    expect(overview.breakEvenRoas).toBeCloseTo(2.857, 3)
    expect(overview.range).toEqual(day)
    expect(overview.previousRange).toEqual({ from: '2026-10-20', to: '2026-10-20' })
  })

  it('reports orders with unknown campaigns as unmatched and counts non-ad orders', async () => {
    await insertSpend({ platform: 'meta', campaignId: '123', date: '2026-10-21', spendSatang: 10000 })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 30000, utm: { source: 'fb', campaign: '123' } })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 7000, utm: { source: 'facebook', campaign: '999' } })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 4000, utm: { source: 'newsletter', campaign: 'spring' } })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 1000, utm: { source: 'google', campaign: null } })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 500 })

    const overview = await metrics().overview(day, 35)

    expect(overview.summary.revenueSatang).toBe(30000)
    expect(overview.summary.orders).toBe(1)
    expect(overview.summary.unmatched).toEqual({ revenueSatang: 11000, orders: 2 })
    expect(overview.summary.nonAdOrders).toBe(2)
    const unmatched = overview.campaigns.filter(row => row.spendSatang === null)
    expect(unmatched.map(row => [row.platform, row.utmSource, row.campaignId, row.revenueSatang, row.verdict])).toEqual([
      ['meta', 'facebook', '999', 7000, null],
      [null, 'newsletter', 'spring', 4000, null],
    ])
  })

  it('merges aliases of one platform on the same campaign into a single row', async () => {
    await insertSpend({ platform: 'meta', campaignId: '123', date: '2026-10-21', spendSatang: 10000 })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 20000, utm: { source: 'fb', campaign: '123' } })
    await insertOrder({ createdAt: '2026-10-21T06:00:00Z', subtotalSatang: 5000, utm: { source: 'Instagram', campaign: '123' } })
    await insertOrder({ createdAt: '2026-10-21T07:00:00Z', subtotalSatang: 3000, utm: { source: 'fb', campaign: '123' } })

    const overview = await metrics().overview(day, 35)

    expect(overview.campaigns).toHaveLength(1)
    expect(overview.campaigns[0]).toMatchObject({ platform: 'meta', campaignId: '123', orders: 3, revenueSatang: 28000, utmSource: 'fb' })
    expect(overview.summary).toMatchObject({ orders: 3, revenueSatang: 28000, spendSatang: 10000 })
    expect(overview.summary.unmatched).toEqual({ revenueSatang: 0, orders: 0 })
  })

  it('does not match a campaign id on a different platform', async () => {
    await insertSpend({ platform: 'tiktok', campaignId: '123', date: '2026-10-21', spendSatang: 10000 })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 5000, utm: { source: 'facebook', campaign: '123' } })

    const overview = await metrics().overview(day, 35)

    expect(overview.summary.orders).toBe(0)
    expect(overview.summary.unmatched.orders).toBe(1)
    const tiktok = overview.campaigns.find(row => row.platform === 'tiktok')
    expect(tiktok).toMatchObject({ spendSatang: 10000, orders: 0, verdict: 'no_sales' })
  })

  it('keeps a campaign matched on a day without spend', async () => {
    await insertSpend({ platform: 'meta', campaignId: '123', date: '2026-10-19', spendSatang: 10000, name: 'Old name' })
    await insertSpend({ platform: 'meta', campaignId: '123', date: '2026-10-20', spendSatang: 5000, name: 'New name' })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 5000, utm: { source: 'meta', campaign: '123' } })

    const overview = await metrics().overview(day, 35)

    expect(overview.summary).toMatchObject({ spendSatang: 0, revenueSatang: 5000, orders: 1, roas: null })
    expect(overview.summary.unmatched).toEqual({ revenueSatang: 0, orders: 0 })
    expect(overview.campaigns).toHaveLength(1)
    expect(overview.campaigns[0]).toMatchObject({
      platform: 'meta', campaignId: '123', campaignName: 'New name', spendSatang: 0, orders: 1, roas: null, verdict: null,
    })
  })

  it('uses the most recent row for the campaign name and sorts by spend then revenue', async () => {
    const range = { from: '2026-10-20', to: '2026-10-21' }
    await insertSpend({ platform: 'meta', campaignId: 'a', date: '2026-10-20', spendSatang: 1000, name: 'A old' })
    await insertSpend({ platform: 'meta', campaignId: 'a', date: '2026-10-21', spendSatang: 1000, name: 'A new' })
    await insertSpend({ platform: 'meta', campaignId: 'b', date: '2026-10-21', spendSatang: 5000 })
    await insertSpend({ platform: 'tiktok', campaignId: 'c', date: '2026-10-21', spendSatang: 2000 })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 9000, utm: { source: 'tiktok', campaign: 'c' } })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 100, utm: { source: 'x', campaign: 'u1' } })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 800, utm: { source: 'x', campaign: 'u2' } })

    const overview = await metrics().overview(range, 35)

    expect(overview.campaigns.map(row => row.campaignId)).toEqual(['b', 'c', 'a', 'u2', 'u1'])
    expect(overview.campaigns.find(row => row.campaignId === 'a')?.campaignName).toBe('A new')
    expect(overview.summary.spendSatang).toBe(9000)
  })

  it('excludes non-THB spend from totals and warns with the platform', async () => {
    await insertSpend({ platform: 'meta', campaignId: '123', date: '2026-10-21', spendSatang: 10000 })
    await insertSpend({ platform: 'google', campaignId: 'g1', date: '2026-10-21', spendSatang: 777000, currency: 'USD' })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 4000, utm: { source: 'adwords', campaign: 'g1' } })

    const overview = await metrics().overview(day, 35)

    expect(overview.summary.spendSatang).toBe(10000)
    expect(overview.warnings).toContainEqual({ code: 'NON_THB_CURRENCY', platform: 'google' })
    expect(overview.warnings.filter(warning => warning.code === 'NON_THB_CURRENCY')).toHaveLength(1)
    const google = overview.campaigns.find(row => row.campaignId === 'g1')
    expect(google).toMatchObject({ platform: 'google', spendSatang: 0, orders: 1, verdict: null })
  })

  it('computes previous-period totals from matched orders and THB spend', async () => {
    await insertSpend({ platform: 'meta', campaignId: '123', date: '2026-10-20', spendSatang: 4000 })
    await insertSpend({ platform: 'meta', campaignId: '123', date: '2026-10-21', spendSatang: 10000 })
    await insertSpend({ platform: 'meta', campaignId: '123', date: '2026-10-19', spendSatang: 99999 })
    await insertOrder({ createdAt: '2026-10-20T05:00:00Z', subtotalSatang: 9000, utm: { source: 'meta', campaign: '123' } })
    await insertOrder({ createdAt: '2026-10-20T05:00:00Z', subtotalSatang: 777, utm: { source: 'meta', campaign: 'nope' } })
    await insertOrder({ createdAt: '2026-10-21T05:00:00Z', subtotalSatang: 1000, utm: { source: 'meta', campaign: '123' } })

    const overview = await metrics().overview(day, 35)

    expect(overview.summary.previous).toEqual({ spendSatang: 4000, revenueSatang: 9000, orders: 1, roas: 2.25 })
  })

  it('warns about missing platforms, late spend data and non-Bangkok accounts', async () => {
    await insertSpend({ platform: 'meta', campaignId: '123', date: '2026-10-22', spendSatang: 100 })
    await insertSpend({ platform: 'google', campaignId: 'g1', date: '2026-10-10', spendSatang: 100 })
    await insertRun('meta', 'succeeded', 'America/Los_Angeles', '2026-10-21T00:00:00Z')
    await insertRun('meta', 'failed', null, '2026-10-22T00:00:00Z')
    await insertRun('google', 'succeeded', 'Asia/Bangkok', '2026-10-21T00:00:00Z')
    await insertRun('tiktok', 'succeeded', 'Asia/Singapore', '2026-10-20T00:00:00Z')
    await insertRun('tiktok', 'succeeded', null, '2026-10-21T00:00:00Z')

    const overview = await metrics(['meta', 'google', 'tiktok']).overview({ from: '2026-10-20', to: '2026-10-22' }, 35)

    expect(overview.warnings).toContainEqual({ code: 'SPEND_DATA_STARTS_LATE', platform: 'meta', date: '2026-10-22' })
    expect(overview.warnings).toContainEqual({ code: 'NON_BANGKOK_TIMEZONE', platform: 'meta' })
    expect(overview.warnings.map(warning => warning.code)).not.toContain('NO_PLATFORM_CONFIGURED')
    // google starts before the range, tiktok has no spend rows, and its latest run has no timezone
    expect(overview.warnings.filter(warning => warning.code === 'SPEND_DATA_STARTS_LATE')).toHaveLength(1)
    expect(overview.warnings.filter(warning => warning.code === 'NON_BANGKOK_TIMEZONE')).toHaveLength(1)

    const none = await metrics([]).overview(day, 35)
    expect(none.warnings).toContainEqual({ code: 'NO_PLATFORM_CONFIGURED' })
    expect(none.warnings.map(warning => warning.code)).not.toContain('SPEND_DATA_STARTS_LATE')
  })
})
