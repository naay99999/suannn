import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { inventoryLot, inventoryReservation, inventoryReservationAllocation } from './inventory'
import { product, productVariant } from './products'

export const cart = pgTable('cart', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerId: text('customer_id').references(() => user.id, { onDelete: 'cascade' }),
  guestTokenHash: text('guest_token_hash'),
  version: integer('version').notNull().default(1),
  lastMutationAt: timestamp('last_mutation_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check('cart_owner_shape_check', sql`
    (${table.customerId} is not null and ${table.guestTokenHash} is null and ${table.expiresAt} is null)
    or (${table.customerId} is null and ${table.guestTokenHash} is not null and ${table.expiresAt} is not null)
  `),
  check('cart_version_positive_check', sql`${table.version} > 0`),
  uniqueIndex('cart_customer_owner_unique').on(table.customerId).where(sql`${table.customerId} is not null`),
  uniqueIndex('cart_guest_token_hash_unique').on(table.guestTokenHash).where(sql`${table.guestTokenHash} is not null`),
  index('cart_guest_expiry_idx').on(table.expiresAt).where(sql`${table.guestTokenHash} is not null`),
])

export const cartItem = pgTable('cart_item', {
  id: uuid('id').defaultRandom().primaryKey(),
  cartId: uuid('cart_id').notNull().references(() => cart.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariant.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check('cart_item_quantity_range_check', sql`${table.quantity} between 1 and 99`),
  uniqueIndex('cart_item_cart_variant_unique').on(table.cartId, table.variantId),
  index('cart_item_variant_idx').on(table.variantId),
])

export const commerceSettings = pgTable('commerce_settings', {
  id: integer('id').primaryKey(),
  shippingFeeSatang: integer('shipping_fee_satang'),
  checkoutEnabled: boolean('checkout_enabled').notNull().default(false),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check('commerce_settings_singleton_check', sql`${table.id} = 1`),
  check('commerce_settings_shipping_fee_nonnegative_check', sql`${table.shippingFeeSatang} is null or ${table.shippingFeeSatang} >= 0`),
  check('commerce_settings_enabled_requires_fee_check', sql`not ${table.checkoutEnabled} or ${table.shippingFeeSatang} is not null`),
  check('commerce_settings_version_positive_check', sql`${table.version} > 0`),
])

const MAX_SAFE_SATANG = 9007199254740991
const maxSafeSatangSql = sql.raw(String(MAX_SAFE_SATANG))

export const commerceOrder = pgTable('commerce_order', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderNumber: text('order_number').notNull(),
  customerId: text('customer_id').references(() => user.id, { onDelete: 'restrict' }),
  guestAccessTokenHash: text('guest_access_token_hash'),
  guestAccessTokenNonce: text('guest_access_token_nonce'),
  guestAccessTokenVersion: integer('guest_access_token_version'),
  contactEmail: text('contact_email').notNull(),
  contactPhone: text('contact_phone').notNull(),
  recipientName: text('recipient_name').notNull(),
  addressLine1: text('address_line_1').notNull(),
  addressLine2: text('address_line_2'),
  subdistrict: text('subdistrict').notNull(),
  district: text('district').notNull(),
  province: text('province').notNull(),
  postalCode: text('postal_code').notNull(),
  subtotalSatang: bigint('subtotal_satang', { mode: 'number' }).notNull(),
  shippingSatang: bigint('shipping_satang', { mode: 'number' }).notNull(),
  totalSatang: bigint('total_satang', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('THB'),
  paymentMethod: text('payment_method').notNull().default('cod'),
  status: text('status', { enum: ['pending_payment', 'placed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'] })
    .notNull().default('placed'),
  reservationId: uuid('reservation_id').notNull().references(() => inventoryReservation.id, { onDelete: 'restrict' }),
  quoteFingerprint: text('quote_fingerprint').notNull(),
  terminalAt: timestamp('terminal_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex('commerce_order_number_unique').on(table.orderNumber),
  uniqueIndex('commerce_order_reservation_unique').on(table.reservationId),
  unique('commerce_order_id_reservation_unique').on(table.id, table.reservationId),
  unique('commerce_order_id_payment_method_total_unique').on(table.id, table.paymentMethod, table.totalSatang),
  index('commerce_order_customer_created_idx').on(table.customerId, table.createdAt, table.id),
  index('commerce_order_status_created_idx').on(table.status, table.createdAt, table.id),
  check('commerce_order_number_nonblank_check', sql`length(btrim(${table.orderNumber})) between 1 and 80`),
  check('commerce_order_owner_shape_check', sql`
    (${table.customerId} is not null
      and ${table.guestAccessTokenHash} is null
      and ${table.guestAccessTokenNonce} is null
      and ${table.guestAccessTokenVersion} is null)
    or (${table.customerId} is null
      and ${table.guestAccessTokenHash} is not null
      and ${table.guestAccessTokenHash} ~ '^[0-9a-f]{64}$'
      and ${table.guestAccessTokenNonce} is not null
      and length(btrim(${table.guestAccessTokenNonce})) between 1 and 200
      and ${table.guestAccessTokenVersion} is not null
      and ${table.guestAccessTokenVersion} > 0)
  `),
  check('commerce_order_contact_email_check', sql`
    length(btrim(${table.contactEmail})) between 3 and 320
    and ${table.contactEmail} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
  `),
  check('commerce_order_contact_phone_check', sql`
    ${table.contactPhone} ~ '^[+0-9][+0-9 ()-]{6,39}$'
  `),
  check('commerce_order_recipient_name_check', sql`length(btrim(${table.recipientName})) between 1 and 200`),
  check('commerce_order_address_line_1_check', sql`length(btrim(${table.addressLine1})) between 1 and 300`),
  check('commerce_order_address_line_2_check', sql`${table.addressLine2} is null or length(btrim(${table.addressLine2})) between 1 and 300`),
  check('commerce_order_subdistrict_check', sql`length(btrim(${table.subdistrict})) between 1 and 200`),
  check('commerce_order_district_check', sql`length(btrim(${table.district})) between 1 and 200`),
  check('commerce_order_province_check', sql`length(btrim(${table.province})) between 1 and 200`),
  check('commerce_order_postal_code_check', sql`${table.postalCode} ~ '^[0-9]{5}$'`),
  check('commerce_order_money_safe_range_check', sql`
    ${table.subtotalSatang} between 0 and ${maxSafeSatangSql}
    and ${table.shippingSatang} between 0 and ${maxSafeSatangSql}
    and ${table.totalSatang} between 0 and ${maxSafeSatangSql}
  `),
  check('commerce_order_total_matches_parts_check', sql`
    ${table.subtotalSatang} + ${table.shippingSatang} = ${table.totalSatang}
    and ${table.subtotalSatang} + ${table.shippingSatang} <= ${maxSafeSatangSql}
  `),
  check('commerce_order_currency_check', sql`${table.currency} = 'THB'`),
  check('commerce_order_payment_method_nonblank_check', sql`length(btrim(${table.paymentMethod})) between 1 and 80`),
  check('commerce_order_status_check', sql`${table.status} in ('pending_payment', 'placed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled')`),
  check('commerce_order_quote_fingerprint_check', sql`${table.quoteFingerprint} ~ '^[0-9a-f]{64}$'`),
])

export const orderItem = pgTable('order_item', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => commerceOrder.id, { onDelete: 'restrict' }),
  productId: uuid('product_id').notNull().references(() => product.id, { onDelete: 'restrict' }),
  variantId: uuid('variant_id').notNull().references(() => productVariant.id, { onDelete: 'restrict' }),
  sku: text('sku').notNull(),
  productName: text('product_name').notNull(),
  variantName: text('variant_name').notNull(),
  unit: text('unit').notNull(),
  unitPriceSatang: bigint('unit_price_satang', { mode: 'number' }).notNull(),
  quantity: integer('quantity').notNull(),
  lineTotalSatang: bigint('line_total_satang', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('order_item_id_order_unique').on(table.id, table.orderId),
  uniqueIndex('order_item_order_variant_unique').on(table.orderId, table.variantId),
  index('order_item_product_idx').on(table.productId),
  index('order_item_variant_idx').on(table.variantId),
  check('order_item_snapshot_text_check', sql`
    length(btrim(${table.sku})) between 1 and 120
    and length(btrim(${table.productName})) between 1 and 300
    and length(btrim(${table.variantName})) between 1 and 200
    and length(btrim(${table.unit})) between 1 and 80
  `),
  check('order_item_quantity_range_check', sql`${table.quantity} between 1 and 99`),
  check('order_item_unit_price_safe_range_check', sql`${table.unitPriceSatang} between 1 and ${maxSafeSatangSql}`),
  check('order_item_line_total_safe_range_check', sql`${table.lineTotalSatang} between 1 and ${maxSafeSatangSql}`),
  check('order_item_line_total_matches_quantity_check', sql`
    ${table.unitPriceSatang} <= ${maxSafeSatangSql} / greatest(${table.quantity}, 1)
    and ${table.unitPriceSatang} * ${table.quantity} = ${table.lineTotalSatang}
  `),
])

export const orderItemAllocation = pgTable('order_item_allocation', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull(),
  orderItemId: uuid('order_item_id').notNull().references(() => orderItem.id, { onDelete: 'restrict' }),
  lotId: uuid('lot_id').notNull().references(() => inventoryLot.id, { onDelete: 'restrict' }),
  reservationId: uuid('reservation_id').notNull(),
  reservationAllocationId: uuid('reservation_allocation_id').notNull(),
  quantity: integer('quantity').notNull(),
  restorationStatus: text('restoration_status', { enum: ['reversible', 'restored', 'released'] })
    .notNull().default('reversible'),
  restoredAt: timestamp('restored_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: 'order_item_allocation_item_order_fk',
    columns: [table.orderItemId, table.orderId],
    foreignColumns: [orderItem.id, orderItem.orderId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'order_item_allocation_order_reservation_fk',
    columns: [table.orderId, table.reservationId],
    foreignColumns: [commerceOrder.id, commerceOrder.reservationId],
  }).onDelete('restrict'),
  foreignKey({
    name: 'order_item_allocation_reservation_lot_quantity_fk',
    columns: [table.reservationId, table.reservationAllocationId, table.lotId, table.quantity],
    foreignColumns: [inventoryReservationAllocation.reservationId, inventoryReservationAllocation.id, inventoryReservationAllocation.lotId, inventoryReservationAllocation.quantity],
  }).onDelete('restrict'),
  uniqueIndex('order_item_allocation_reservation_allocation_unique').on(table.reservationAllocationId),
  index('order_item_allocation_item_idx').on(table.orderItemId),
  index('order_item_allocation_lot_idx').on(table.lotId),
  check('order_item_allocation_quantity_range_check', sql`${table.quantity} between 1 and 1000000`),
  check('order_item_allocation_restoration_state_check', sql`
    (${table.restorationStatus} = 'restored' and ${table.restoredAt} is not null)
    or (${table.restorationStatus} in ('reversible', 'released') and ${table.restoredAt} is null)
  `),
])

export const payment = pgTable('payment', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => commerceOrder.id, { onDelete: 'restrict' }),
  method: text('method').notNull(),
  provider: text('provider').notNull(),
  amountSatang: bigint('amount_satang', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('THB'),
  status: text('status', { enum: ['awaiting_collection', 'collected', 'void'] }).notNull().default('awaiting_collection'),
  providerReference: text('provider_reference'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex('payment_id_order_unique').on(table.id, table.orderId),
  foreignKey({
    name: 'payment_order_method_amount_fk',
    columns: [table.orderId, table.method, table.amountSatang],
    foreignColumns: [commerceOrder.id, commerceOrder.paymentMethod, commerceOrder.totalSatang],
  }).onDelete('restrict'),
  uniqueIndex('payment_one_active_per_order_unique').on(table.orderId).where(sql`${table.status} <> 'void'`),
  index('payment_status_created_idx').on(table.status, table.createdAt),
  check('payment_method_nonblank_check', sql`length(btrim(${table.method})) between 1 and 80`),
  check('payment_provider_nonblank_check', sql`length(btrim(${table.provider})) between 1 and 80`),
  check('payment_cod_provider_check', sql`${table.method} <> 'cod' or ${table.provider} = 'cod'`),
  check('payment_amount_safe_range_check', sql`${table.amountSatang} between 0 and ${maxSafeSatangSql}`),
  check('payment_currency_check', sql`${table.currency} = 'THB'`),
  check('payment_status_check', sql`${table.status} in ('awaiting_collection', 'collected', 'void')`),
  check('payment_provider_reference_check', sql`${table.providerReference} is null or length(btrim(${table.providerReference})) between 1 and 200`),
])

export const stripeCheckoutAttempt = pgTable('stripe_checkout_attempt', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => commerceOrder.id, { onDelete: 'restrict' }),
  stripeSessionId: text('stripe_session_id'),
  checkoutUrl: text('checkout_url'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  stripeIdempotencyKey: text('stripe_idempotency_key').notNull(),
  status: text('status', { enum: ['creating', 'open', 'completed', 'expired', 'failed'] }).notNull().default('creating'),
  lastCreateCallAt: timestamp('last_create_call_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex('stripe_checkout_attempt_order_unique').on(table.orderId),
  uniqueIndex('stripe_checkout_attempt_session_unique').on(table.stripeSessionId).where(sql`${table.stripeSessionId} is not null`),
  uniqueIndex('stripe_checkout_attempt_idempotency_unique').on(table.stripeIdempotencyKey),
  index('stripe_checkout_attempt_unresolved_idx').on(table.lastCreateCallAt, table.createdAt)
    .where(sql`${table.status} in ('creating', 'open')`),
  check('stripe_checkout_attempt_session_shape_check', sql`
    (${table.stripeSessionId} is null and ${table.checkoutUrl} is null)
    or (${table.stripeSessionId} is not null and ${table.checkoutUrl} is not null and ${table.expiresAt} is not null)
  `),
  check('stripe_checkout_attempt_url_check', sql`${table.checkoutUrl} is null or ${table.checkoutUrl} ~ '^https://[^[:space:]]+$'`),
  check('stripe_checkout_attempt_idempotency_key_check', sql`length(btrim(${table.stripeIdempotencyKey})) between 1 and 255`),
  check('stripe_checkout_attempt_status_check', sql`${table.status} in ('creating', 'open', 'completed', 'expired', 'failed')`),
])

export const stripeEvent = pgTable('stripe_event', {
  stripeEventId: text('stripe_event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('stripe_event_created_idx').on(table.createdAt),
  check('stripe_event_id_check', sql`${table.stripeEventId} ~ '^evt_[A-Za-z0-9]+$'`),
  check('stripe_event_type_check', sql`length(btrim(${table.eventType})) between 1 and 200`),
])

export const stripeRefund = pgTable('stripe_refund', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id').notNull(),
  orderId: uuid('order_id').notNull(),
  requestActorType: text('request_actor_type', { enum: ['staff', 'system'] }).notNull().default('staff'),
  requestActorId: text('request_actor_id'),
  idempotencyKey: text('idempotency_key').notNull(),
  stripeIdempotencyKey: text('stripe_idempotency_key').notNull(),
  stripeRefundId: text('stripe_refund_id'),
  amountSatang: bigint('amount_satang', { mode: 'number' }).notNull(),
  status: text('status', { enum: ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'] }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  foreignKey({
    name: 'stripe_refund_payment_order_fk',
    columns: [table.paymentId, table.orderId],
    foreignColumns: [payment.id, payment.orderId],
  }).onDelete('restrict'),
  uniqueIndex('stripe_refund_payment_idempotency_unique').on(table.paymentId, table.idempotencyKey),
  uniqueIndex('stripe_refund_stripe_idempotency_unique').on(table.stripeIdempotencyKey),
  uniqueIndex('stripe_refund_stripe_id_unique').on(table.stripeRefundId).where(sql`${table.stripeRefundId} is not null`),
  uniqueIndex('stripe_refund_one_live_full_per_payment_unique').on(table.paymentId)
    .where(sql`${table.status} in ('pending', 'requires_action', 'succeeded')`),
  index('stripe_refund_unresolved_idx').on(table.updatedAt, table.createdAt)
    .where(sql`${table.status} in ('pending', 'requires_action')`),
  check('stripe_refund_amount_safe_range_check', sql`${table.amountSatang} between 1 and ${maxSafeSatangSql}`),
  check('stripe_refund_actor_shape_check', sql`
    (${table.requestActorType} = 'staff' and ${table.requestActorId} is not null and length(btrim(${table.requestActorId})) between 1 and 200)
    or (${table.requestActorType} = 'system' and ${table.requestActorId} is null)
  `),
  check('stripe_refund_idempotency_key_check', sql`length(btrim(${table.idempotencyKey})) between 1 and 128`),
  check('stripe_refund_stripe_idempotency_key_check', sql`length(btrim(${table.stripeIdempotencyKey})) between 1 and 255`),
  check('stripe_refund_stripe_id_check', sql`${table.stripeRefundId} is null or ${table.stripeRefundId} ~ '^re_[A-Za-z0-9]+$'`),
  check('stripe_refund_status_check', sql`${table.status} in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')`),
])

export const orderOperation = pgTable('order_operation', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => commerceOrder.id, { onDelete: 'restrict' }),
  scope: text('scope').notNull(),
  command: text('command').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  httpStatus: integer('http_status').notNull(),
  resultPayload: jsonb('result_payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('order_operation_scope_command_key_unique').on(table.scope, table.command, table.idempotencyKey),
  index('order_operation_order_created_idx').on(table.orderId, table.createdAt),
  check('order_operation_scope_check', sql`length(btrim(${table.scope})) between 1 and 200`),
  check('order_operation_command_check', sql`length(btrim(${table.command})) between 1 and 80`),
  check('order_operation_idempotency_key_check', sql`${table.idempotencyKey} ~ '^[!-~]{1,128}$'`),
  check('order_operation_request_hash_check', sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  check('order_operation_http_status_check', sql`${table.httpStatus} between 100 and 599`),
  check('order_operation_result_object_check', sql`jsonb_typeof(${table.resultPayload}) = 'object'`),
])

export const orderEvent = pgTable('order_event', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => commerceOrder.id, { onDelete: 'restrict' }),
  paymentId: uuid('payment_id').references(() => payment.id, { onDelete: 'restrict' }),
  eventType: text('event_type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  actorType: text('actor_type', { enum: ['customer', 'guest', 'staff', 'system'] }).notNull(),
  actorId: text('actor_id'),
  reasonCode: text('reason_code'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('order_event_id_order_type_unique').on(table.id, table.orderId, table.eventType),
  index('order_event_order_created_idx').on(table.orderId, table.createdAt, table.id),
  check('order_event_type_nonblank_check', sql`length(btrim(${table.eventType})) between 1 and 100`),
  check('order_event_actor_type_check', sql`${table.actorType} in ('customer', 'guest', 'staff', 'system')`),
  check('order_event_status_values_check', sql`
    (${table.fromStatus} is null or ${table.fromStatus} in ('pending_payment', 'placed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'))
    and (${table.toStatus} is null or ${table.toStatus} in ('pending_payment', 'placed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'))
  `),
  check('order_event_actor_identity_check', sql`
    (${table.actorType} = 'system' and ${table.actorId} is null)
    or (${table.actorType} in ('customer', 'guest', 'staff')
      and ${table.actorId} is not null
      and length(btrim(${table.actorId})) between 1 and 200)
  `),
  check('order_event_reason_code_check', sql`${table.reasonCode} is null or length(btrim(${table.reasonCode})) between 1 and 100`),
  check('order_event_metadata_object_check', sql`jsonb_typeof(${table.metadata}) = 'object'`),
])

export const orderOutbox = pgTable('order_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => commerceOrder.id, { onDelete: 'restrict' }),
  orderEventId: uuid('order_event_id').notNull(),
  eventType: text('event_type').notNull(),
  templateId: text('template_id').notNull(),
  status: text('status', { enum: ['pending', 'processing', 'sent', 'failed'] }).notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  lastErrorCode: text('last_error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  foreignKey({
    name: 'order_outbox_event_order_type_fk',
    columns: [table.orderEventId, table.orderId, table.eventType],
    foreignColumns: [orderEvent.id, orderEvent.orderId, orderEvent.eventType],
  }).onDelete('restrict'),
  uniqueIndex('order_outbox_event_id_unique').on(table.orderEventId),
  index('order_outbox_due_idx').on(table.nextAttemptAt, table.createdAt).where(sql`${table.status} in ('pending', 'failed')`),
  check('order_outbox_event_type_check', sql`length(btrim(${table.eventType})) between 1 and 100`),
  check('order_outbox_template_id_check', sql`${table.templateId} ~ '^[a-z0-9_]{1,100}$'`),
  check('order_outbox_status_check', sql`${table.status} in ('pending', 'processing', 'sent', 'failed')`),
  check('order_outbox_attempt_count_check', sql`${table.attemptCount} between 0 and 1000000`),
  check('order_outbox_claim_state_check', sql`
    (${table.status} = 'processing' and ${table.claimedAt} is not null)
    or (${table.status} <> 'processing' and ${table.claimedAt} is null)
  `),
  check('order_outbox_sent_state_check', sql`
    (${table.status} = 'sent' and ${table.sentAt} is not null)
    or (${table.status} <> 'sent' and ${table.sentAt} is null)
  `),
  check('order_outbox_error_code_check', sql`${table.lastErrorCode} is null or ${table.lastErrorCode} ~ '^[A-Z0-9_]{1,100}$'`),
])
