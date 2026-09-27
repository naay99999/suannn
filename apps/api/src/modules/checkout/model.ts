import { t } from 'elysia'

const uuid = t.String({ format: 'uuid' })
const nullableUuid = t.Union([uuid, t.Null()])
const nullableString = t.Union([t.String(), t.Null()])
const emptyBody = t.Object({}, { additionalProperties: false })

const quoteLine = t.Object({
  variantId: uuid,
  productId: nullableUuid,
  productName: nullableString,
  variantName: nullableString,
  unit: nullableString,
  quantity: t.Integer({ minimum: 1, maximum: 99 }),
  unitPriceSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  lineTotalSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })

const quote = t.Object({
  cartVersion: t.Integer({ minimum: 0 }),
  settingsVersion: t.Integer({ minimum: 1 }),
  currency: t.Literal('THB'),
  lines: t.Array(quoteLine),
  subtotalSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  shippingSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  totalSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  expiresAt: t.String({ format: 'date-time' }),
  quoteToken: t.String({ minLength: 1, maxLength: 8192 }),
}, { additionalProperties: false })

const address = t.Union([
  t.Object({ addressId: uuid }, { additionalProperties: false }),
  t.Object({
    recipientName: t.String({ minLength: 1, maxLength: 200 }),
    addressLine1: t.String({ minLength: 1, maxLength: 300 }),
    addressLine2: t.Optional(t.Union([t.String({ maxLength: 300 }), t.Null()])),
    subdistrict: t.String({ minLength: 1, maxLength: 200 }),
    district: t.String({ minLength: 1, maxLength: 200 }),
    province: t.String({ minLength: 1, maxLength: 200 }),
    postalCode: t.String({ pattern: '^[0-9]{5}$' }),
  }, { additionalProperties: false }),
])

const placeOrderBody = t.Object({
  quoteToken: t.String({ minLength: 1, maxLength: 8192 }),
  paymentMethod: t.Union([t.Literal('cod'), t.Literal('stripe')]),
  contact: t.Object({
    email: t.String({ format: 'email', minLength: 3, maxLength: 320 }),
    phone: t.String({ pattern: '^[+0-9][+0-9 ()-]{6,39}$' }),
  }, { additionalProperties: false }),
  address,
}, { additionalProperties: false })

const idempotencyHeaders = t.Object({
  'idempotency-key': t.String({ pattern: '^[!-~]{1,128}$' }),
})

export const checkoutModels = {
  'checkout.emptyBody': emptyBody,
  'checkout.quoteLine': quoteLine,
  'checkout.quote': quote,
  'checkout.placeOrderBody': placeOrderBody,
  'checkout.idempotencyHeaders': idempotencyHeaders,
}
