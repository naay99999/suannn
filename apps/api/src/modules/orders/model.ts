import { t } from 'elysia'

const uuid = t.String({ format: 'uuid' })
const nullableCustomerId = t.Union([t.String(), t.Null()])
const status = t.Union([
  t.Literal('pending_payment'),
  t.Literal('placed'),
  t.Literal('processing'),
  t.Literal('packed'),
  t.Literal('shipped'),
  t.Literal('delivered'),
  t.Literal('cancelled'),
])

const item = t.Object({
  id: uuid,
  productId: uuid,
  variantId: uuid,
  sku: t.String(),
  productName: t.String(),
  variantName: t.String(),
  unit: t.String(),
  unitPriceSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  quantity: t.Integer({ minimum: 1, maximum: 99 }),
  lineTotalSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })

const snapshot = t.Object({
  id: uuid,
  orderNumber: t.String(),
  status,
  customerId: nullableCustomerId,
  contactEmail: t.String({ format: 'email' }),
  contactPhone: t.String(),
  recipientName: t.String(),
  addressLine1: t.String(),
  addressLine2: t.Union([t.String(), t.Null()]),
  subdistrict: t.String(),
  district: t.String(),
  province: t.String(),
  postalCode: t.String({ pattern: '^[0-9]{5}$' }),
  subtotalSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  shippingSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  totalSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  currency: t.Literal('THB'),
  paymentMethod: t.Union([t.Literal('cod'), t.Literal('stripe')]),
  createdAt: t.String({ format: 'date-time' }),
  items: t.Array(item),
}, { additionalProperties: false })

const payment = t.Object({
  id: uuid,
  method: t.String(),
  provider: t.String(),
  amountSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  currency: t.Literal('THB'),
  status: t.Union([
    t.Literal('awaiting_collection'),
    t.Literal('collected'),
    t.Literal('void'),
  ]),
  refund: t.Optional(t.Object({
    id: uuid,
    amountSatang: t.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    status: t.Union([
      t.Literal('pending'),
      t.Literal('requires_action'),
      t.Literal('succeeded'),
      t.Literal('failed'),
      t.Literal('canceled'),
    ]),
    createdAt: t.String({ format: 'date-time' }),
    updatedAt: t.String({ format: 'date-time' }),
  }, { additionalProperties: false })),
}, { additionalProperties: false })

const detail = t.Composite([snapshot, t.Object({ payment })], { additionalProperties: false })
const page = t.Object({ items: t.Array(detail), nextCursor: t.Union([t.String(), t.Null()]) }, { additionalProperties: false })
const createResponse = t.Object({
  order: snapshot,
  guestAccessToken: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
}, { additionalProperties: false })
const idParams = t.Object({ orderId: uuid }, { additionalProperties: false })
const listQuery = t.Object({
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })),
}, { additionalProperties: false })
const idempotencyHeaders = t.Object({ 'idempotency-key': t.String({ pattern: '^[!-~]{1,128}$' }) })
const emptyBody = t.Object({}, { additionalProperties: false })
const fulfillmentBody = t.Object({
  status: t.Union([t.Literal('processing'), t.Literal('packed'), t.Literal('shipped'), t.Literal('delivered')]),
}, { additionalProperties: false })
const collectCodBody = t.Object({
  amountSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })
const guestAccessBody = t.Object({
  reasonCode: t.Union([
    t.Literal('customer_request'),
    t.Literal('suspected_compromise'),
    t.Literal('support_recovery'),
  ]),
}, { additionalProperties: false })

export const ordersModels = {
  'orders.snapshot': snapshot,
  'orders.detail': detail,
  'orders.page': page,
  'orders.createResponse': createResponse,
  'orders.idParams': idParams,
  'orders.listQuery': listQuery,
  'orders.idempotencyHeaders': idempotencyHeaders,
  'orders.emptyBody': emptyBody,
  'orders.fulfillmentBody': fulfillmentBody,
  'orders.collectCodBody': collectCodBody,
  'orders.guestAccessBody': guestAccessBody,
}
