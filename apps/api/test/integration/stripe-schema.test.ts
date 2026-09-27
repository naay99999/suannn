import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readOrderDetail } from '../../src/modules/orders/repository'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

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

async function insertOrder() {
  const id = crypto.randomUUID()
  const reservationId = crypto.randomUUID()
  await database.client.unsafe(`
    insert into inventory_reservation (id, warehouse_id, expires_at, actor_id)
    values ($1, '00000000-0000-4000-8000-000000000001', now() + interval '30 minutes', 'stripe-schema-test')
  `, [reservationId])
  await database.client.unsafe(`
    insert into commerce_order (
      id, order_number, guest_access_token_hash, guest_access_token_nonce,
      guest_access_token_version, contact_email, contact_phone, recipient_name,
      address_line_1, subdistrict, district, province, postal_code,
      subtotal_satang, shipping_satang, total_satang, currency, payment_method,
      status, reservation_id, quote_fingerprint
    ) values (
      $1, $2, $3, $4, 1, 'buyer@example.com', '+66812345678', 'Buyer',
      '12 Sample Road', 'Subdistrict', 'District', 'Bangkok', '10110',
      1000, 0, 1000, 'THB', 'stripe', 'pending_payment', $5, $6
    )
  `, [id, `STRIPE-${id}`, 'b'.repeat(64), crypto.randomUUID(), reservationId, 'c'.repeat(64)])
  return id
}

async function insertStripePayment(orderId: string, status = 'awaiting_collection') {
  const id = crypto.randomUUID()
  await database.client.unsafe(`
    insert into payment (id, order_id, method, provider, amount_satang, currency, status)
    values ($1, $2, 'stripe', 'stripe', 1000, 'THB', $3)
  `, [id, orderId, status])
  return id
}

async function expectUniqueViolation(query: () => Promise<unknown>) {
  await expect((async () => { await query() })()).rejects.toMatchObject({ code: '23505' })
}

describe('Stripe persistence schema', () => {
  it('enforces unique checkout attempts per order and Session IDs', async () => {
    const orderId = await insertOrder()
    const sessionId = `cs_${crypto.randomUUID()}`
    const attemptId = crypto.randomUUID()
    await database.client.unsafe(`
      insert into stripe_checkout_attempt (id, order_id, stripe_idempotency_key, last_create_call_at)
      values ($1, $2, $3, now())
    `, [attemptId, orderId, `checkout-${attemptId}`])
    await expectUniqueViolation(() => database.client.unsafe(`
      insert into stripe_checkout_attempt (order_id, stripe_idempotency_key, last_create_call_at)
      values ($1, $2, now())
    `, [orderId, `checkout-${crypto.randomUUID()}`]))
    await database.client.unsafe(`
      update stripe_checkout_attempt set stripe_session_id = $2, checkout_url = 'https://checkout.stripe.com/session', expires_at = now() + interval '30 minutes'
      where id = $1
    `, [attemptId, sessionId])
    const secondOrderId = await insertOrder()
    await expectUniqueViolation(() => database.client.unsafe(`
      insert into stripe_checkout_attempt (order_id, stripe_session_id, checkout_url, expires_at, stripe_idempotency_key, last_create_call_at)
      values ($1, $2, 'https://checkout.stripe.com/another', now() + interval '30 minutes', $3, now())
    `, [secondOrderId, sessionId, `checkout-${crypto.randomUUID()}`]))
  })

  it('deduplicates Stripe events and Refund IDs', async () => {
    await database.client.unsafe(`
      insert into stripe_event (stripe_event_id, event_type) values ('evt_SchemaUnique', 'checkout.session.completed')
    `)
    await expectUniqueViolation(() => database.client.unsafe(`
      insert into stripe_event (stripe_event_id, event_type) values ('evt_SchemaUnique', 'checkout.session.expired')
    `))

    const orderId = await insertOrder()
    const paymentId = await insertStripePayment(orderId)
    const refundId = 're_SchemaUnique'
    await database.client.unsafe(`
      insert into stripe_refund (payment_id, order_id, request_actor_id, idempotency_key, stripe_idempotency_key, amount_satang, status, stripe_refund_id)
      values ($1, $2, 'staff-schema-test', 'refund-first', 'refund-stripe-first', 1000, 'pending', $3)
    `, [paymentId, orderId, refundId])
    const nextOrderId = await insertOrder()
    const nextPaymentId = await insertStripePayment(nextOrderId)
    await expectUniqueViolation(() => database.client.unsafe(`
      insert into stripe_refund (payment_id, order_id, request_actor_id, idempotency_key, stripe_idempotency_key, amount_satang, status, stripe_refund_id)
      values ($1, $2, 'staff-schema-test', 'refund-next', 'refund-stripe-next', 1000, 'pending', $3)
    `, [nextPaymentId, nextOrderId, refundId]))
  })

  it('allows only one active or successful full refund and allows a retry after failure', async () => {
    const orderId = await insertOrder()
    const paymentId = await insertStripePayment(orderId)
    const base = [paymentId, orderId]
    await database.client.unsafe(`
      insert into stripe_refund (payment_id, order_id, request_actor_id, idempotency_key, stripe_idempotency_key, amount_satang, status)
      values ($1, $2, 'staff-schema-test', 'refund-active-1', 'refund-stripe-active-1', 1000, 'pending')
    `, base)
    await expectUniqueViolation(() => database.client.unsafe(`
      insert into stripe_refund (payment_id, order_id, request_actor_id, idempotency_key, stripe_idempotency_key, amount_satang, status)
      values ($1, $2, 'staff-schema-test', 'refund-active-2', 'refund-stripe-active-2', 1000, 'requires_action')
    `, base))
    await database.client.unsafe(`update stripe_refund set status = 'failed' where idempotency_key = 'refund-active-1'`)
    await database.client.unsafe(`
      insert into stripe_refund (payment_id, order_id, request_actor_id, idempotency_key, stripe_idempotency_key, amount_satang, status)
      values ($1, $2, 'staff-schema-test', 'refund-retry', 'refund-stripe-retry', 1000, 'pending')
    `, base)
    await database.client.unsafe(`update stripe_refund set status = 'succeeded' where idempotency_key = 'refund-retry'`)
    await expectUniqueViolation(() => database.client.unsafe(`
      insert into stripe_refund (payment_id, order_id, request_actor_id, idempotency_key, stripe_idempotency_key, amount_satang, status)
      values ($1, $2, 'staff-schema-test', 'refund-after-success', 'refund-stripe-after-success', 1000, 'pending')
    `, base))
  })

  it('projects Stripe payment and refund state without guest secrets', async () => {
    const orderId = await insertOrder()
    const paymentId = await insertStripePayment(orderId, 'collected')
    await database.client.unsafe(`
      update commerce_order set status = 'placed' where id = $1
    `, [orderId])
    await database.client.unsafe(`
      insert into stripe_refund (payment_id, order_id, request_actor_id, idempotency_key, stripe_idempotency_key, amount_satang, status)
      values ($1, $2, 'staff-schema-test', 'refund-projection', 'refund-stripe-projection', 1000, 'requires_action')
    `, [paymentId, orderId])

    const detail = await database.db.transaction((tx) => readOrderDetail(tx, orderId))
    expect(detail.paymentMethod).toBe('stripe')
    expect(detail.payment).toMatchObject({ method: 'stripe', provider: 'stripe', amountSatang: 1000, status: 'collected' })
    expect(detail.payment.refund).toMatchObject({ amountSatang: 1000, status: 'requires_action' })
    expect(JSON.stringify(detail)).not.toContain('guestAccessToken')
    expect(JSON.stringify(detail)).not.toContain('guest_access_token_hash')
    expect(JSON.stringify(detail)).not.toContain('stripe_idempotency_key')
  })
})
