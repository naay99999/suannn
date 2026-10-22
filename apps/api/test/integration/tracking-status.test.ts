import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { adSpendDaily, commerceOrder, marketingSyncRun, inventoryReservation, trackingAlert, trackingOutbox, warehouse } from '../../src/database/schema'
import type { TrackingConfig } from '../../src/config/env'
import { TrackingAlerts } from '../../src/modules/tracking/alerts'
import { TrackingStatusRepository } from '../../src/modules/tracking/status/repository'
import { TrackingStatusService } from '../../src/modules/tracking/status/service'
import type { TrackingDestination } from '../../src/modules/tracking/types'
import { FakeEmailSender } from '../helpers/fakes'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined
const hour = 3_600_000
const metaConfig: TrackingConfig = {
  posthog: null,
  meta: { pixelId: '1', accessToken: 'token', testEventCode: null },
  tiktok: null,
  googleAds: null,
  alertEmail: 'owner@example.test',
}

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

beforeEach(async () => {
  await database.db.delete(trackingOutbox)
  await database.db.delete(trackingAlert)
  await database.db.delete(marketingSyncRun)
  await database.db.delete(adSpendDaily)
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

async function insertOrder() {
  const [mainWarehouse] = await database.db.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.code, 'MAIN'))
  if (!mainWarehouse) throw new Error('Expected MAIN warehouse')
  const id = crypto.randomUUID()
  const reservationId = crypto.randomUUID()
  const created = new Date()
  await database.db.insert(inventoryReservation).values({
    id: reservationId,
    warehouseId: mainWarehouse.id,
    status: 'confirmed',
    createdAt: created,
    expiresAt: new Date(created.getTime() + 86_400_000),
    completedAt: created,
    actorId: 'tracking-status-test',
  })
  await database.db.insert(commerceOrder).values({
    id,
    orderNumber: `TS-${id.replaceAll('-', '')}`,
    customerId: null,
    guestAccessTokenHash: 'a'.repeat(64),
    guestAccessTokenNonce: `tracking-status-${id}`,
    guestAccessTokenVersion: 1,
    contactEmail: 'tracking-status@example.test',
    contactPhone: '081-234-5678',
    recipientName: 'Tracking Status',
    addressLine1: '1 Main Road',
    subdistrict: 'Talat Noi',
    district: 'Samphanthawong',
    province: 'Bangkok',
    postalCode: '10100',
    billingName: 'Tracking Status',
    billingPhone: '081-234-5678',
    billingAddressLine1: '1 Main Road',
    billingSubdistrict: 'Talat Noi',
    billingDistrict: 'Samphanthawong',
    billingProvince: 'Bangkok',
    billingPostalCode: '10100',
    subtotalSatang: 1000,
    shippingSatang: 0,
    totalSatang: 1000,
    status: 'placed',
    reservationId,
    quoteFingerprint: 'b'.repeat(64),
  })
  return id
}

async function insertRow(destination: TrackingDestination, values: Partial<typeof trackingOutbox.$inferInsert> = {}) {
  await database.db.insert(trackingOutbox).values({
    orderId: await insertOrder(),
    destination,
    eventName: 'purchase',
    expiresAt: new Date(Date.now() + 24 * hour),
    ...values,
  })
}

const failed = (minutesAgo: number, errorCode = 'META_HTTP_500') => ({
  status: 'failed' as const,
  lastFailedAt: new Date(Date.now() - minutesAgo * 60_000),
  lastErrorCode: errorCode,
})

describe('TrackingStatusService', () => {
  it('summarizes sent and failed rows per destination', async () => {
    const sentAt = new Date(Date.now() - 2 * hour)
    await insertRow('meta', { status: 'sent', sentAt })
    await insertRow('meta', { status: 'sent', sentAt: new Date(Date.now() - 5 * hour) })
    await insertRow('meta', failed(30, 'META_HTTP_429'))
    await insertRow('meta', { status: 'expired', lastFailedAt: new Date(Date.now() - 3 * hour), lastErrorCode: 'META_HTTP_500' })
    await insertRow('meta', { status: 'failed', lastFailedAt: new Date(Date.now() - 30 * hour), lastErrorCode: 'OLD' })
    await insertRow('tiktok', failed(10, 'TIKTOK_HTTP_500'))

    const config = { ...metaConfig, tiktok: { pixelCode: 'p', accessToken: 't', testEventCode: null } }
    const result = await new TrackingStatusService(new TrackingStatusRepository(database.db), config).get()

    expect(result.destinations.map(({ destination }) => destination)).toEqual(['posthog', 'meta', 'tiktok', 'google_ads'])
    expect(result.destinations[0]).toEqual({
      destination: 'posthog', configured: false, lastSuccessAt: null, failures24h: 0, lastErrorCode: null,
    })
    expect(result.destinations[1]).toEqual({
      destination: 'meta', configured: true, lastSuccessAt: sentAt.toISOString(), failures24h: 2, lastErrorCode: 'META_HTTP_429',
    })
    expect(result.destinations[2]).toMatchObject({ destination: 'tiktok', configured: true, failures24h: 1, lastErrorCode: 'TIKTOK_HTTP_500' })
    expect(result.destinations[3]).toMatchObject({ destination: 'google_ads', configured: false, failures24h: 0 })
  })
})

describe('TrackingStatusService ad spend', () => {
  const run = (platform: 'meta' | 'tiktok' | 'google', hoursAgo: number, status: 'running' | 'succeeded' | 'failed', errorCode: string | null = null) => {
    const startedAt = new Date(Date.now() - hoursAgo * hour)
    return database.db.insert(marketingSyncRun).values({
      platform, startedAt, status, errorCode, rangeFrom: '2026-10-01', rangeTo: '2026-10-03',
      finishedAt: status === 'running' ? null : new Date(startedAt.getTime() + 60_000),
    })
  }

  it('reports run health per platform in order', async () => {
    await run('meta', 10, 'succeeded')
    await run('meta', 8, 'failed', 'META_HTTP_500')
    await run('meta', 7, 'succeeded')
    await run('meta', 2, 'failed', 'META_HTTP_429')
    await run('tiktok', 3, 'running')
    await run('google', 5, 'succeeded')
    await run('google', 3, 'running')
    await run('google', 2, 'running')
    await database.db.insert(adSpendDaily).values(['2026-10-02', '2026-09-20'].map((date) => ({
      platform: 'meta' as const, accountId: 'a', campaignId: 'c', date, spendSatang: 1, currency: 'THB', syncedAt: new Date(),
    })))

    const service = new TrackingStatusService(new TrackingStatusRepository(database.db), metaConfig, ['meta', 'google'])
    const { adSpend } = await service.get()

    expect(adSpend.map(({ platform }) => platform)).toEqual(['meta', 'tiktok', 'google'])
    expect(adSpend[0]).toEqual({
      platform: 'meta',
      configured: true,
      lastSuccessAt: expect.any(String),
      lastRunStatus: 'failed',
      lastErrorCode: 'META_HTTP_429',
      earliestDate: '2026-09-20',
    })
    const metaSuccess = Date.now() - 7 * hour + 60_000
    expect(Math.abs(new Date(adSpend[0]!.lastSuccessAt!).getTime() - metaSuccess)).toBeLessThan(5_000)
    // Running for 3 h is stuck, so it shows as failed with the stale code; the DB is untouched.
    expect(adSpend[1]).toEqual({
      platform: 'tiktok', configured: false, lastSuccessAt: null, lastRunStatus: 'failed',
      lastErrorCode: 'SPEND_SYNC_STALE_RUN', earliestDate: null,
    })
    expect(adSpend[2]).toMatchObject({ platform: 'google', configured: true, lastRunStatus: 'failed', lastErrorCode: 'SPEND_SYNC_STALE_RUN' })
    const [stored] = await database.db.select().from(marketingSyncRun).where(eq(marketingSyncRun.platform, 'tiktok'))
    expect(stored!.status).toBe('running')
  })

  it('returns unconfigured empty rows when no platform has runs', async () => {
    const { adSpend } = await new TrackingStatusService(new TrackingStatusRepository(database.db), metaConfig).get()
    expect(adSpend).toEqual((['meta', 'tiktok', 'google'] as const).map((platform) => ({
      platform, configured: false, lastSuccessAt: null, lastRunStatus: null, lastErrorCode: null, earliestDate: null,
    })))
  })

  it('shows a fresh running run as running', async () => {
    await run('meta', 0.1, 'running')
    const { adSpend } = await new TrackingStatusService(new TrackingStatusRepository(database.db), metaConfig, ['meta']).get()
    expect(adSpend[0]).toMatchObject({ lastRunStatus: 'running', lastErrorCode: null })
  })
})

describe('TrackingAlerts', () => {
  function create(config: TrackingConfig = metaConfig, now = () => new Date()) {
    const sender = new FakeEmailSender()
    return { sender, alerts: new TrackingAlerts(database.db, config, sender, 'https://admin.example.test', now) }
  }

  it('alerts once after five failures since the last success', async () => {
    await insertRow('meta', { status: 'sent', sentAt: new Date(Date.now() - 3 * hour) })
    for (let index = 1; index <= 5; index += 1) await insertRow('meta', failed(index))
    const { alerts, sender } = create()

    await alerts.check()
    expect(sender.messages).toHaveLength(1)
    expect(sender.messages[0]).toMatchObject({
      to: 'owner@example.test',
      template: 'tracking-alert',
      subject: '[suannn] Tracking delivery failing: Meta',
    })
    expect(sender.messages[0]!.text).toContain('META_HTTP_500')
    expect(sender.messages[0]!.text).toContain('https://admin.example.test/settings')
    expect(sender.messages[0]!.text).not.toContain('example.test/orders')

    await alerts.check()
    expect(sender.messages).toHaveLength(1)
  })

  it('does not alert for fewer than five failures or failures older than the last success', async () => {
    for (let index = 1; index <= 4; index += 1) await insertRow('meta', failed(index))
    await insertRow('meta', { status: 'sent', sentAt: new Date() })
    for (let index = 0; index < 5; index += 1) await insertRow('meta', failed(60 + index))
    const { alerts, sender } = create()
    await alerts.check()
    expect(sender.messages).toHaveLength(0)
  })

  it('alerts again after 25 hours while failures persist', async () => {
    for (let index = 1; index <= 5; index += 1) await insertRow('meta', failed(index))
    let current = new Date()
    const { alerts, sender } = create(metaConfig, () => current)
    await alerts.check()
    expect(sender.messages).toHaveLength(1)
    current = new Date(current.getTime() + 25 * hour)
    await alerts.check()
    expect(sender.messages).toHaveLength(2)
  })

  it('alerts when nothing succeeded for 24 hours and a stale row is unsent', async () => {
    await insertRow('meta', { status: 'sent', sentAt: new Date(Date.now() - 30 * hour) })
    await insertRow('meta', { status: 'pending', createdAt: new Date(Date.now() - 2 * hour) })
    const { alerts, sender } = create()
    await alerts.check()
    expect(sender.messages).toHaveLength(1)
  })

  it('does not alert for recent pending rows, skipped rows, or recent success', async () => {
    await insertRow('meta', { status: 'pending', createdAt: new Date(Date.now() - 10 * 60_000) })
    await insertRow('meta', { status: 'skipped', createdAt: new Date(Date.now() - 3 * hour) })
    const { alerts, sender } = create()
    await alerts.check()
    expect(sender.messages).toHaveLength(0)

    await insertRow('meta', { status: 'sent', sentAt: new Date() })
    await insertRow('meta', { status: 'pending', createdAt: new Date(Date.now() - 3 * hour) })
    await alerts.check()
    expect(sender.messages).toHaveLength(0)
  })

  it('sends nothing without an alert email or for unconfigured destinations', async () => {
    for (let index = 1; index <= 5; index += 1) await insertRow('meta', failed(index))
    const none = create({ ...metaConfig, alertEmail: null })
    await none.alerts.check()
    expect(none.sender.messages).toHaveLength(0)

    const unconfigured = create({ ...metaConfig, meta: null })
    await unconfigured.alerts.check()
    expect(unconfigured.sender.messages).toHaveLength(0)
  })

  it('releases the throttle when the email fails to send', async () => {
    for (let index = 1; index <= 5; index += 1) await insertRow('meta', failed(index))
    const { alerts, sender } = create()
    sender.error = new Error('down')
    await alerts.check()
    sender.error = undefined
    await alerts.check()
    expect(sender.messages.filter(({ subject }) => subject.includes('Meta')).length).toBe(2)
  })
})
