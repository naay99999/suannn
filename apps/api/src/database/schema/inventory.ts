import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
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
import { productVariant } from './products'

export const warehouse = pgTable('warehouse', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex('warehouse_code_unique').on(table.code),
  check('warehouse_code_nonblank_check', sql`length(btrim(${table.code})) between 1 and 100`),
  check('warehouse_name_nonblank_check', sql`length(btrim(${table.name})) between 1 and 200`),
])

export const inventoryOperation = pgTable('inventory_operation', {
  id: uuid('id').defaultRandom().primaryKey(),
  scope: text('scope').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  httpStatus: integer('http_status').notNull(),
  resultPayload: jsonb('result_payload').$type<Record<string, unknown>>().notNull(),
  actorId: text('actor_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('inventory_operation_scope_key_unique').on(table.scope, table.idempotencyKey),
  check('inventory_operation_scope_nonblank_check', sql`length(btrim(${table.scope})) between 1 and 100`),
  check('inventory_operation_idempotency_key_check', sql`${table.idempotencyKey} ~ '^[!-~]{1,128}$'`),
  check('inventory_operation_request_hash_check', sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  check('inventory_operation_http_status_check', sql`${table.httpStatus} between 100 and 599`),
])

export const inventoryLot = pgTable('inventory_lot', {
  id: uuid('id').defaultRandom().primaryKey(),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouse.id, { onDelete: 'restrict' }),
  variantId: uuid('variant_id').notNull().references(() => productVariant.id, { onDelete: 'restrict' }),
  lotCode: text('lot_code').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  expiryDate: date('expiry_date', { mode: 'string' }).notNull(),
  quarantinedAt: timestamp('quarantined_at', { withTimezone: true }),
  quarantineReason: text('quarantine_reason'),
  onHandQuantity: integer('on_hand_quantity').default(0).notNull(),
  reservedQuantity: integer('reserved_quantity').default(0).notNull(),
  reversibleQuantity: integer('reversible_quantity').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  unique('inventory_lot_id_variant_unique').on(table.id, table.variantId),
  uniqueIndex('inventory_lot_normalized_code_unique')
    .on(table.warehouseId, table.variantId, sql`upper(btrim(${table.lotCode}))`),
  index('inventory_lot_allocation_fifo_idx')
    .on(table.warehouseId, table.variantId, table.receivedAt, table.id),
  index('inventory_lot_availability_expiry_idx')
    .on(table.warehouseId, table.variantId, table.expiryDate),
  check('inventory_lot_code_format_check', sql`btrim(${table.lotCode}) ~* '^[a-z0-9._/-]{1,100}$'`),
  check('inventory_lot_on_hand_quantity_range_check', sql`${table.onHandQuantity} between 0 and 1000000000`),
  check('inventory_lot_reserved_quantity_range_check', sql`${table.reservedQuantity} between 0 and 1000000000`),
  check('inventory_lot_reserved_not_over_on_hand_check', sql`${table.reservedQuantity} <= ${table.onHandQuantity}`),
  check('inventory_lot_reversible_quantity_range_check', sql`${table.reversibleQuantity} between 0 and 1000000000`),
  check('inventory_lot_on_hand_plus_reversible_capacity_check', sql`${table.onHandQuantity} + ${table.reversibleQuantity} <= 1000000000`),
])

export const stockMovement = pgTable('stock_movement', {
  id: uuid('id').defaultRandom().primaryKey(),
  lotId: uuid('lot_id').notNull().references(() => inventoryLot.id, { onDelete: 'restrict' }),
  operationId: uuid('operation_id').notNull().references(() => inventoryOperation.id, { onDelete: 'restrict' }),
  quantityDelta: integer('quantity_delta').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  type: text('type', { enum: ['receipt', 'write_off', 'count_adjustment', 'reservation_confirm', 'order_cancel_restore'] }).notNull(),
  reasonCode: text('reason_code').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  actorId: text('actor_id').notNull(),
}, (table) => [
  index('stock_movement_lot_history_idx').on(table.lotId, table.occurredAt, table.id),
  index('stock_movement_operation_idx').on(table.operationId),
  check('stock_movement_type_check', sql`${table.type} in ('receipt', 'write_off', 'count_adjustment', 'reservation_confirm', 'order_cancel_restore')`),
  check('stock_movement_quantity_delta_nonzero_check', sql`${table.quantityDelta} <> 0`),
  check('stock_movement_balance_after_range_check', sql`${table.balanceAfter} between 0 and 1000000000`),
  check('stock_movement_type_delta_sign_check', sql`
    (${table.type} = 'receipt' and ${table.quantityDelta} > 0)
    or (${table.type} in ('write_off', 'reservation_confirm') and ${table.quantityDelta} < 0)
    or (${table.type} = 'order_cancel_restore' and ${table.quantityDelta} > 0)
    or ${table.type} = 'count_adjustment'
  `),
  check('stock_movement_reason_code_nonblank_check', sql`length(btrim(${table.reasonCode})) between 1 and 100`),
])

export const inventoryReservation = pgTable('inventory_reservation', {
  id: uuid('id').defaultRandom().primaryKey(),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouse.id, { onDelete: 'restrict' }),
  externalReference: text('external_reference'),
  status: text('status', { enum: ['active', 'confirmed', 'released', 'expired', 'cancelled'] }).default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  actorId: text('actor_id').notNull(),
}, (table) => [
  index('inventory_reservation_status_expiry_idx').on(table.status, table.expiresAt),
  check('inventory_reservation_status_check', sql`${table.status} in ('active', 'confirmed', 'released', 'expired', 'cancelled')`),
  check('inventory_reservation_expiry_after_creation_check', sql`${table.expiresAt} > ${table.createdAt}`),
])

export const inventoryReservationAllocation = pgTable('inventory_reservation_allocation', {
  id: uuid('id').defaultRandom().primaryKey(),
  reservationId: uuid('reservation_id').notNull(),
  variantId: uuid('variant_id').notNull(),
  lotId: uuid('lot_id').notNull(),
  quantity: integer('quantity').notNull(),
}, (table) => [
  unique('inventory_reservation_allocation_id_lot_quantity_unique').on(table.id, table.lotId, table.quantity),
  foreignKey({
    name: 'inventory_reservation_allocation_reservation_fk',
    columns: [table.reservationId],
    foreignColumns: [inventoryReservation.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'inventory_reservation_allocation_lot_variant_fk',
    columns: [table.lotId, table.variantId],
    foreignColumns: [inventoryLot.id, inventoryLot.variantId],
  }).onDelete('restrict'),
  uniqueIndex('inventory_reservation_allocation_reservation_lot_unique').on(table.reservationId, table.lotId),
  index('inventory_reservation_allocation_lot_idx').on(table.lotId),
  index('inventory_reservation_allocation_variant_idx').on(table.variantId),
  check('inventory_reservation_allocation_quantity_range_check', sql`${table.quantity} between 1 and 1000000`),
])
