import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from '../helpers/database'

const MAIN_WAREHOUSE_ID = '00000000-0000-4000-8000-000000000001'
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

async function insertUser() {
  const id = `tracking-schema-user-${crypto.randomUUID()}`
  await database.client.unsafe(`
    insert into "user" (id, name, email, email_verified, created_at, updated_at, role, account_type)
    values ($1, 'Tracking schema user', $2, false, now(), now(), 'customer', 'customer')
  `, [id, `${id}@example.com`])
  return id
}

async function insertOrder() {
  const id = crypto.randomUUID()
  const reservationId = crypto.randomUUID()
  await database.client.unsafe(`
    insert into inventory_reservation (id, warehouse_id, expires_at, actor_id)
    values ($1, $2, now() + interval '15 minutes', 'tracking-schema-test')
  `, [reservationId, MAIN_WAREHOUSE_ID])
  await database.client.unsafe(`
    insert into commerce_order (
      id, order_number, customer_id,
      guest_access_token_hash, guest_access_token_nonce, guest_access_token_version,
      contact_email, contact_phone, recipient_name, address_line_1,
      subdistrict, district, province, postal_code,
      billing_name, billing_phone, billing_address_line_1,
      billing_subdistrict, billing_district, billing_province, billing_postal_code,
      subtotal_satang, shipping_satang, total_satang, currency, payment_method,
      status, reservation_id, quote_fingerprint
    ) values (
      $1, $2, null, $3, $4, 1, 'buyer@example.com', '+66812345678', 'Recipient', '12 Road',
      'Sub', 'District', 'Bangkok', '10110',
      'Recipient', '+66812345678', '12 Road',
      'Sub', 'District', 'Bangkok', '10110',
      100, 25, 125, 'THB', 'cod', 'placed', $5, $6
    )
  `, [id, `ORD-${id}`, 'b'.repeat(64), crypto.randomUUID(), reservationId, 'c'.repeat(64)])
  return id
}

async function insertConsent(customerId: string | null = null) {
  const id = crypto.randomUUID()
  await database.client.unsafe(`
    insert into consent_record (id, visitor_id, customer_id, analytics, marketing, policy_version, request_id)
    values ($1, $2, $3, true, false, 'v1', 'req-1')
  `, [id, crypto.randomUUID(), customerId])
  return id
}

async function insertOutbox(orderId: string, destination = 'posthog', eventName = 'purchase') {
  await database.client.unsafe(`
    insert into tracking_outbox (id, order_id, destination, event_name, expires_at)
    values ($1, $2, $3, $4, now() + interval '7 days')
  `, [crypto.randomUUID(), orderId, destination, eventName])
}

async function expectRejects(query: () => Promise<unknown>) {
  await expect(query()).rejects.toThrow()
}

describe('tracking schema constraints', () => {
  it('rejects duplicate (order, destination, event) outbox rows', async () => {
    const orderId = await insertOrder()
    await insertOutbox(orderId, 'meta')
    await expectRejects(() => insertOutbox(orderId, 'meta'))
    await insertOutbox(orderId, 'tiktok')
  })

  it('rejects unknown destinations and event names, defaults status to pending', async () => {
    const orderId = await insertOrder()
    await expectRejects(() => insertOutbox(orderId, 'ga4'))
    await expectRejects(() => insertOutbox(orderId, 'posthog', 'refund'))
    await insertOutbox(orderId, 'google_ads')
    const rows = await database.client.unsafe<{ status: string; attempt_count: number }[]>(
      `select status, attempt_count from tracking_outbox where order_id = $1`, [orderId])
    expect([...rows]).toEqual([{ status: 'pending', attempt_count: 0 }])
  })

  it('rejects a malformed consent visitor id', async () => {
    await expectRejects(async () => database.client.unsafe(`
      insert into consent_record (id, visitor_id, analytics, marketing, policy_version, request_id)
      values ($1, 'not-a-uuid', true, true, 'v1', 'req-1')
    `, [crypto.randomUUID()]))
  })

  it('restricts deleting a consent record referenced by an order attribution', async () => {
    const orderId = await insertOrder()
    const consentId = await insertConsent()
    await database.client.unsafe(`
      insert into order_attribution (order_id, consent_record_id, analytics_consent, marketing_consent)
      values ($1, $2, true, false)
    `, [orderId, consentId])
    await expectRejects(async () => database.client.unsafe(`delete from consent_record where id = $1`, [consentId]))
  })

  it('sets consent_record.customer_id to null when the user is deleted', async () => {
    const userId = await insertUser()
    const consentId = await insertConsent(userId)
    await database.client.unsafe(`delete from "user" where id = $1`, [userId])
    const rows = await database.client.unsafe<{ customer_id: string | null }[]>(
      `select customer_id from consent_record where id = $1`, [consentId])
    expect([...rows]).toEqual([{ customer_id: null }])
  })

  it('keeps one alert row per destination', async () => {
    await database.client.unsafe(`insert into tracking_alert (destination, last_sent_at) values ('meta', now())`)
    await expectRejects(async () => database.client.unsafe(`insert into tracking_alert (destination, last_sent_at) values ('meta', now())`))
  })
})
