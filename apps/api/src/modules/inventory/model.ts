import { t } from 'elysia'

const uuid = t.String({ format: 'uuid' })
const dateTime = t.String({ format: 'date-time' })
const nullableDateTime = t.Union([dateTime, t.Null()])
const nullableString = t.Union([t.String(), t.Null()])
const pageLimit = t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 }))
const cursor = t.Optional(t.String({ minLength: 1, maxLength: 512 }))
const idempotencyKey = t.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[!-~]{1,128}$',
  description: 'A retry key of 1–128 visible ASCII characters without whitespace.',
})

const warehouse = t.Object({
  id: uuid,
  code: t.String({ minLength: 1, maxLength: 100 }),
  name: t.String({ minLength: 1, maxLength: 200 }),
  isActive: t.Boolean(),
  createdAt: dateTime,
  updatedAt: dateTime,
}, { additionalProperties: false })

const lot = t.Object({
  id: uuid,
  warehouseId: uuid,
  variantId: uuid,
  lotCode: t.String({ minLength: 1, maxLength: 100 }),
  receivedAt: dateTime,
  expiryDate: t.String({ format: 'date' }),
  quarantinedAt: nullableDateTime,
  quarantineReason: nullableString,
  onHandQuantity: t.Integer({ minimum: 0, maximum: 1_000_000_000 }),
  reservedQuantity: t.Integer({ minimum: 0, maximum: 1_000_000_000 }),
  sellableQuantity: t.Integer({ minimum: 0, maximum: 1_000_000_000 }),
  createdAt: dateTime,
  updatedAt: dateTime,
}, { additionalProperties: false })

const variantSummary = t.Object({
  variantId: uuid,
  warehouseId: uuid,
  onHandQuantity: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  reservedQuantity: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  eligibleQuantity: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  sellableQuantity: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })

const movement = t.Object({
  id: uuid,
  lotId: uuid,
  operationId: uuid,
  quantityDelta: t.Integer({ minimum: -1_000_000_000, maximum: 1_000_000_000 }),
  balanceAfter: t.Integer({ minimum: 0, maximum: 1_000_000_000 }),
  type: t.Union([
    t.Literal('receipt'), t.Literal('write_off'),
    t.Literal('count_adjustment'), t.Literal('reservation_confirm'),
    t.Literal('order_cancel_restore'),
  ]),
  reasonCode: t.String({ minLength: 1, maxLength: 100 }),
  occurredAt: dateTime,
  actorId: t.String({ minLength: 1 }),
}, { additionalProperties: false })

const reservationStatus = t.Union([
  t.Literal('active'), t.Literal('confirmed'), t.Literal('released'),
  t.Literal('expired'), t.Literal('cancelled'),
])

const reservation = t.Object({
  id: uuid,
  warehouseId: uuid,
  externalReference: nullableString,
  status: reservationStatus,
  createdAt: dateTime,
  expiresAt: dateTime,
  completedAt: nullableDateTime,
  actorId: t.String({ minLength: 1 }),
  allocations: t.Array(t.Object({
    variantId: uuid,
    lotId: uuid,
    quantity: t.Integer({ minimum: 1, maximum: 1_000_000 }),
  }, { additionalProperties: false })),
}, { additionalProperties: false })

const lotPage = t.Object({ items: t.Array(lot), nextCursor: nullableString }, { additionalProperties: false })
const movementPage = t.Object({ items: t.Array(movement), nextCursor: nullableString }, { additionalProperties: false })

const warehouseId = t.String({ minLength: 1, format: 'uuid' })
const lotQuery = t.Object({
  warehouseId: t.Optional(warehouseId),
  variantId: t.Optional(t.String({ minLength: 1, format: 'uuid' })),
  limit: pageLimit,
  cursor,
}, { additionalProperties: false })

const movementQuery = t.Object({
  warehouseId: t.Optional(warehouseId),
  variantId: t.Optional(t.String({ minLength: 1, format: 'uuid' })),
  lotId: t.Optional(t.String({ minLength: 1, format: 'uuid' })),
  limit: pageLimit,
  cursor,
}, { additionalProperties: false })

const variantParams = t.Object({ variantId: uuid }, { additionalProperties: false })
const lotParams = t.Object({ lotId: uuid }, { additionalProperties: false })
const reservationParams = t.Object({ reservationId: uuid }, { additionalProperties: false })

const receiveBody = t.Object({
  warehouseId: uuid,
  variantId: uuid,
  lotCode: t.String({ minLength: 1, maxLength: 102 }),
  quantity: t.Integer({ minimum: 1, maximum: 1_000_000_000 }),
  expiryDate: t.String({ format: 'date' }),
  receivedAt: t.Optional(dateTime),
  quarantined: t.Optional(t.Boolean()),
  quarantineReason: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
}, { additionalProperties: false })

const quarantineBody = t.Object({
  reason: t.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: false })

const emptyBody = t.Object({}, { additionalProperties: false })

const writeOffBody = t.Object({
  quantity: t.Integer({ minimum: 1, maximum: 1_000_000_000 }),
  reason: t.Union([t.Literal('spoiled'), t.Literal('expired'), t.Literal('damaged')]),
  note: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
}, { additionalProperties: false })

const countAdjustmentBody = t.Object({
  countedQuantity: t.Integer({ minimum: 0, maximum: 1_000_000_000 }),
  reason: t.String({ minLength: 1, maxLength: 100, pattern: '^[a-z][a-z0-9._-]{0,99}$' }),
}, { additionalProperties: false })

const reserveBody = t.Object({
  warehouseId: uuid,
  lines: t.Array(t.Object({
    variantId: uuid,
    quantity: t.Integer({ minimum: 1, maximum: 1_000_000 }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 50 }),
  externalReference: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
}, { additionalProperties: false })

export const inventoryModels = {
  'inventory.warehouse': warehouse,
  'inventory.lot': lot,
  'inventory.lotPage': lotPage,
  'inventory.variantSummary': variantSummary,
  'inventory.movement': movement,
  'inventory.movementPage': movementPage,
  'inventory.reservation': reservation,
  'inventory.lotQuery': lotQuery,
  'inventory.movementQuery': movementQuery,
  'inventory.variantParams': variantParams,
  'inventory.lotParams': lotParams,
  'inventory.reservationParams': reservationParams,
  'inventory.idempotencyHeaders': t.Object({ 'idempotency-key': idempotencyKey }, { additionalProperties: true }),
  'inventory.receiveBody': receiveBody,
  'inventory.quarantineBody': quarantineBody,
  'inventory.emptyBody': emptyBody,
  'inventory.writeOffBody': writeOffBody,
  'inventory.countAdjustmentBody': countAdjustmentBody,
  'inventory.reserveBody': reserveBody,
}
