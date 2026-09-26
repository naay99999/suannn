import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from '../helpers/database'

const MAIN_WAREHOUSE_ID = '00000000-0000-4000-8000-000000000001'
const SAFE_MONEY_MAX = '9007199254740991'
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

async function insertCustomer() {
  const id = `orders-schema-customer-${crypto.randomUUID()}`
  await database.client.unsafe(`
    insert into "user" (id, name, email, email_verified, created_at, updated_at, role, account_type)
    values ($1, 'Order schema customer', $2, false, now(), now(), 'customer', 'customer')
  `, [id, `${id}@example.com`])
  return id
}

async function insertVariant() {
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()

  await database.client.unsafe(`
    insert into product (id, slug, name, category)
    values ($1, $2, 'Order snapshot product', 'fresh')
  `, [productId, `order-schema-${productId}`])
  await database.client.unsafe(`
    insert into product_variant (id, product_id, sku, name, unit, price_satang)
    values ($1, $2, $3, 'Snapshot variant', 'box', 100)
  `, [variantId, productId, `ORDER-SCHEMA-${variantId}`])

  return { productId, variantId }
}

async function insertLot(input: {
  variantId: string
  onHand: number
  reversible?: number
}) {
  const lotId = crypto.randomUUID()
  await database.client.unsafe(`
    insert into inventory_lot (
      id, warehouse_id, variant_id, lot_code, expiry_date,
      on_hand_quantity, reserved_quantity, reversible_quantity
    ) values ($1, $2, $3, $4, '2030-01-01', $5, 0, $6)
  `, [lotId, MAIN_WAREHOUSE_ID, input.variantId, `LOT-${lotId}`, input.onHand, input.reversible ?? 0])
  return lotId
}

async function insertReservation() {
  const id = crypto.randomUUID()
  await database.client.unsafe(`
    insert into inventory_reservation (id, warehouse_id, expires_at, actor_id)
    values ($1, $2, now() + interval '15 minutes', 'order-schema-test')
  `, [id, MAIN_WAREHOUSE_ID])
  return id
}

async function insertInventoryOperation() {
  const id = crypto.randomUUID()
  await database.client.unsafe(`
    insert into inventory_operation (
      id, scope, idempotency_key, request_hash, http_status, result_payload, actor_id
    ) values ($1, 'order-schema-test', $2, $3, 200, '{}'::jsonb, 'order-schema-test')
  `, [id, `movement-${id}`, 'a'.repeat(64)])
  return id
}

async function insertOrder(input: {
  customerId?: string | null
  reservationId?: string
  orderNumber?: string
  subtotal?: string | number
  shipping?: string | number
  total?: string | number
  status?: string
  guestFields?: boolean
  contactEmail?: string
  contactPhone?: string
} = {}) {
  const id = crypto.randomUUID()
  const isGuest = input.customerId === undefined || input.customerId === null
  const guestFields = input.guestFields ?? isGuest
  const guestHash = guestFields ? 'b'.repeat(64) : null
  const guestNonce = guestFields ? crypto.randomUUID() : null
  const guestVersion = guestFields ? 1 : null

  await database.client.unsafe(`
    insert into commerce_order (
      id, order_number, customer_id,
      guest_access_token_hash, guest_access_token_nonce, guest_access_token_version,
      contact_email, contact_phone, recipient_name, address_line_1,
      subdistrict, district, province, postal_code,
      subtotal_satang, shipping_satang, total_satang, currency, payment_method,
      status, reservation_id, quote_fingerprint
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, 'Order Recipient', '12 Sample Road',
      'Sample Subdistrict', 'Sample District', 'Bangkok', '10110',
      $9, $10, $11, 'THB', 'cod', $12, $13, $14
    )
  `, [
    id,
    input.orderNumber ?? `ORD-${id}`,
    input.customerId ?? null,
    guestHash,
    guestNonce,
    guestVersion,
    input.contactEmail ?? 'buyer@example.com',
    input.contactPhone ?? '+66812345678',
    input.subtotal ?? 100,
    input.shipping ?? 25,
    input.total ?? 125,
    input.status ?? 'placed',
    input.reservationId ?? await insertReservation(),
    'c'.repeat(64),
  ])
  return id
}

async function insertOrderItem(input: {
  orderId: string
  productId: string
  variantId: string
  quantity?: number
}) {
  const id = crypto.randomUUID()
  const quantity = input.quantity ?? 1
  await database.client.unsafe(`
    insert into order_item (
      id, order_id, product_id, variant_id, sku, product_name,
      variant_name, unit, unit_price_satang, quantity, line_total_satang
    ) values ($1, $2, $3, $4, 'SNAPSHOT-SKU', 'Snapshot Product',
      'Snapshot Variant', 'box', 100, $5, $6)
  `, [id, input.orderId, input.productId, input.variantId, quantity, 100 * quantity])
  return id
}

async function expectPostgresError(query: () => Promise<unknown>, code: string) {
  await expect((async () => { await query() })()).rejects.toMatchObject({ code })
}

describe('order and reversible inventory schema migration', () => {
  it('enforces guest/customer ownership, contact, and order status invariants', async () => {
    const customerId = await insertCustomer()
    const reservationId = await insertReservation()

    await expectPostgresError(() => insertOrder({ guestFields: false }), '23514')
    await expectPostgresError(() => insertOrder({ customerId, reservationId, guestFields: true }), '23514')
    expect(typeof await insertOrder({ customerId, reservationId })).toBe('string')
    await expectPostgresError(() => insertOrder({ reservationId, contactEmail: ' ' }), '23514')
    await expectPostgresError(() => insertOrder({ reservationId, contactPhone: '' }), '23514')
    await expectPostgresError(() => insertOrder({ reservationId, status: 'pending' }), '23514')
  })

  it('keeps order item snapshots independent of catalog changes and restricts catalog deletion', async () => {
    const { productId, variantId } = await insertVariant()
    const orderId = await insertOrder()
    const itemId = await insertOrderItem({ orderId, productId, variantId, quantity: 2 })

    await database.client.unsafe(`
      update product set name = 'Renamed product' where id = $1
    `, [productId])
    await database.client.unsafe(`
      update product_variant set sku = 'RENAMED-SKU', name = 'Renamed variant', price_satang = 200
      where id = $1
    `, [variantId])

    const [snapshot] = await database.client.unsafe<{ product_name: string; sku: string; unit_price_satang: string }[]>(`
      select product_name, sku, unit_price_satang from order_item where id = $1
    `, [itemId])
    expect(snapshot).toEqual({ product_name: 'Snapshot Product', sku: 'SNAPSHOT-SKU', unit_price_satang: '100' })
    await expectPostgresError(() => database.client.unsafe(`
      update order_item set unit_price_satang = 200, line_total_satang = 400 where id = $1
    `, [itemId]), '23514')
    await expectPostgresError(() => database.client.unsafe(`
      update commerce_order set subtotal_satang = 99, total_satang = 124 where id = $1
    `, [orderId]), '23514')
    await expectPostgresError(() => database.client.unsafe(`delete from product where id = $1`, [productId]), '23503')
    await expectPostgresError(() => database.client.unsafe(`delete from product_variant where id = $1`, [variantId]), '23503')
  })

  it('requires valid order and product references and links item allocations to reservation allocations', async () => {
    const { productId, variantId } = await insertVariant()
    const orderId = await insertOrder()
    const itemId = await insertOrderItem({ orderId, productId, variantId })
    const lotId = await insertLot({ variantId, onHand: 2 })
    const reservationId = await insertReservation()
    const reservationAllocationId = crypto.randomUUID()

    await database.client.unsafe(`
      insert into inventory_reservation_allocation (
        id, reservation_id, variant_id, lot_id, quantity
      ) values ($1, $2, $3, $4, 1)
    `, [reservationAllocationId, reservationId, variantId, lotId])
    await database.client.unsafe(`
      insert into order_item_allocation (order_item_id, lot_id, reservation_allocation_id, quantity)
      values ($1, $2, $3, 1)
    `, [itemId, lotId, reservationAllocationId])

    await expectPostgresError(() => database.client.unsafe(`
      insert into order_item_allocation (order_item_id, lot_id, reservation_allocation_id, quantity)
      values ($1, $2, $3, 1)
    `, [itemId, lotId, crypto.randomUUID()]), '23503')
    const otherVariant = await insertVariant()
    await expectPostgresError(() => database.client.unsafe(`
      insert into order_item (order_id, product_id, variant_id, sku, product_name,
        variant_name, unit, unit_price_satang, quantity, line_total_satang)
      values ($1, $2, $3, 'BAD', 'Bad', 'Bad', 'box', 100, 1, 100)
    `, [orderId, crypto.randomUUID(), otherVariant.variantId]), '23503')
  })

  it('bounds payment amounts and permits only one active payment per order', async () => {
    const orderId = await insertOrder()
    const paymentId = crypto.randomUUID()

    await database.client.unsafe(`
      insert into payment (id, order_id, method, provider, amount_satang, currency, status)
      values ($1, $2, 'cod', 'cod', 125, 'THB', 'awaiting_collection')
    `, [paymentId, orderId])
    await expectPostgresError(() => database.client.unsafe(`
      insert into payment (order_id, method, provider, amount_satang, currency, status)
      values ($1, 'cod', 'cod', 125, 'THB', 'awaiting_collection')
    `, [orderId]), '23505')
    const negativeAmountOrderId = await insertOrder()
    await expectPostgresError(() => database.client.unsafe(`
      insert into payment (order_id, method, provider, amount_satang, currency, status)
      values ($1, 'cod', 'cod', -1, 'THB', 'awaiting_collection')
    `, [negativeAmountOrderId]), '23514')
    const oversizedAmountOrderId = await insertOrder()
    await expectPostgresError(() => database.client.unsafe(`
      insert into payment (order_id, method, provider, amount_satang, currency, status)
      values ($1, 'cod', 'cod', 9007199254740992, 'THB', 'awaiting_collection')
    `, [oversizedAmountOrderId]), '23514')
  })

  it('limits all order totals to safe integers and enforces subtotal plus shipping equals total', async () => {
    await insertOrder({ subtotal: SAFE_MONEY_MAX, shipping: 0, total: SAFE_MONEY_MAX })
    await expect(insertOrder({ subtotal: -1, shipping: 0, total: 0 }))
      .rejects.toMatchObject({ code: '23514' })
    await expect(insertOrder({ subtotal: 100, shipping: 25, total: 124 }))
      .rejects.toMatchObject({ code: '23514' })
    await expect(insertOrder({ subtotal: SAFE_MONEY_MAX, shipping: 1, total: '9007199254740992' }))
      .rejects.toMatchObject({ code: '23514' })
  })

  it('enforces scoped idempotency keys and one outbox intent per order event', async () => {
    const orderId = await insertOrder()
    const operationId = crypto.randomUUID()
    await database.client.unsafe(`
      insert into order_operation (
        id, order_id, scope, command, idempotency_key, request_hash,
        http_status, result_payload
      ) values ($1, $2, 'guest:token-hash', 'checkout', 'checkout-key', $3, 201, '{}'::jsonb)
    `, [operationId, orderId, 'd'.repeat(64)])
    await expectPostgresError(() => database.client.unsafe(`
      insert into order_operation (
        order_id, scope, command, idempotency_key, request_hash, http_status, result_payload
      ) values ($1, 'guest:token-hash', 'checkout', 'checkout-key', $2, 201, '{}'::jsonb)
    `, [orderId, 'e'.repeat(64)]), '23505')

    const eventId = crypto.randomUUID()
    await database.client.unsafe(`
      insert into order_event (id, order_id, event_type, to_status, actor_type, metadata, actor_id)
      values ($1, $2, 'order.placed', 'placed', 'guest', '{}'::jsonb, 'guest:token-hash')
    `, [eventId, orderId])
    await database.client.unsafe(`
      insert into order_outbox (order_id, order_event_id, event_type, template_id)
      values ($1, $2, 'order.placed', 'order_confirmation_v1')
    `, [orderId, eventId])
    await expectPostgresError(() => database.client.unsafe(`
      insert into order_outbox (order_id, order_event_id, event_type, template_id)
      values ($1, $2, 'order.placed', 'order_confirmation_v1')
    `, [orderId, eventId]), '23505')

    const outboxColumns = await database.client.unsafe<{ column_name: string }[]>(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'order_outbox'
    `)
    expect(outboxColumns.map((row) => row.column_name)).not.toContain('guest_access_token')
    expect(outboxColumns.map((row) => row.column_name)).not.toContain('contact_email')
  })

  it('reserves reversible lot capacity and accepts only positive restoration movements', async () => {
    const { variantId } = await insertVariant()
    const lotId = await insertLot({ variantId, onHand: 999_999_999, reversible: 1 })
    const lotRows = await database.client.unsafe<{ reversible_quantity: number }[]>(`
      select reversible_quantity from inventory_lot where id = $1
    `, [lotId])
    expect(lotRows[0]?.reversible_quantity).toBe(1)

    await expectPostgresError(() => insertLot({ variantId, onHand: 1_000_000_000, reversible: 1 }), '23514')
    const defaultLotId = await insertLot({ variantId, onHand: 1_000_000_000 })
    const defaultRows = await database.client.unsafe<{ reversible_quantity: number }[]>(`
      select reversible_quantity from inventory_lot where id = $1
    `, [defaultLotId])
    expect(defaultRows[0]?.reversible_quantity).toBe(0)

    const operationId = await insertInventoryOperation()
    await database.client.unsafe(`
      insert into stock_movement (
        lot_id, operation_id, quantity_delta, balance_after, type, reason_code, actor_id
      ) values ($1, $2, 1, 1, 'order_cancel_restore', 'order_cancel_restore', 'order-schema-test')
    `, [lotId, operationId])
    await expectPostgresError(() => database.client.unsafe(`
      insert into stock_movement (
        lot_id, operation_id, quantity_delta, balance_after, type, reason_code, actor_id
      ) values ($1, $2, -1, 0, 'order_cancel_restore', 'order_cancel_restore', 'order-schema-test')
    `, [lotId, operationId]), '23514')
    await database.client.unsafe(`
      insert into stock_movement (
        lot_id, operation_id, quantity_delta, balance_after, type, reason_code, actor_id
      ) values ($1, $2, 1, 2, 'receipt', 'receipt', 'order-schema-test')
    `, [lotId, operationId])
    await expectPostgresError(() => database.client.unsafe(`
      insert into stock_movement (
        lot_id, operation_id, quantity_delta, balance_after, type, reason_code, actor_id
      ) values ($1, $2, -1, 0, 'receipt', 'receipt', 'order-schema-test')
    `, [lotId, operationId]), '23514')
    await database.client.unsafe(`
      insert into stock_movement (
        lot_id, operation_id, quantity_delta, balance_after, type, reason_code, actor_id
      ) values ($1, $2, -1, 1, 'count_adjustment', 'count', 'order-schema-test')
    `, [lotId, operationId])
    await expectPostgresError(() => database.client.unsafe(`
      insert into stock_movement (
        lot_id, operation_id, quantity_delta, balance_after, type, reason_code, actor_id
      ) values ($1, $2, 1, 2, 'receipt', 'receipt', 'order-schema-test')
    `, [lotId, crypto.randomUUID()]), '23503')
  })
})
