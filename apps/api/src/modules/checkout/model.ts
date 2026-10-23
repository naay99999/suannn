import { t } from 'elysia'

const uuid = t.String({ format: 'uuid' })
const nullableUuid = t.Union([uuid, t.Null()])
const nullableString = t.Union([t.String(), t.Null()])
const quoteBody = t.Object({
  email: t.Optional(t.String({ format: 'email', minLength: 3, maxLength: 254 })),
}, { additionalProperties: false })

const quoteDiscount = t.Object({
  code: t.String(),
  status: t.Union([t.Literal('applied'), t.Literal('pending_email'), t.Literal('not_applicable')]),
  reason: t.Union([
    t.Literal('unknown'),
    t.Literal('not_started'),
    t.Literal('expired'),
    t.Literal('used_up'),
    t.Literal('already_used'),
    t.Literal('min_subtotal'),
    t.Literal('min_quantity'),
    t.Literal('no_eligible_items'),
    t.Literal('first_order_only'),
    t.Null(),
  ]),
  shortfallSatang: t.Union([t.Integer({ minimum: 0 }), t.Null()]),
  itemDiscountSatang: t.Integer({ minimum: 0 }),
  freeShipping: t.Boolean(),
}, { additionalProperties: false })

const quoteLine = t.Object({
  variantId: uuid,
  productId: nullableUuid,
  productName: nullableString,
  variantName: nullableString,
  unit: nullableString,
  quantity: t.Integer({ minimum: 1, maximum: 99 }),
  unitPriceSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  lineTotalSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  discountSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
}, { additionalProperties: false })

const quote = t.Object({
  cartVersion: t.Integer({ minimum: 0 }),
  settingsVersion: t.Integer({ minimum: 1 }),
  currency: t.Literal('THB'),
  lines: t.Array(quoteLine),
  subtotalSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  discountSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  shippingDiscountSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  shippingSatang: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  discount: t.Union([quoteDiscount, t.Null()]),
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
    phone: t.String({ pattern: '^[0-9]{9,10}$' }),
  }, { additionalProperties: false }),
])

const trackingString = t.String({ maxLength: 2000 })
const trackingTouch = t.Object({
  utmSource: t.Optional(trackingString),
  utmMedium: t.Optional(trackingString),
  utmCampaign: t.Optional(trackingString),
  utmContent: t.Optional(trackingString),
  utmTerm: t.Optional(trackingString),
  fbclid: t.Optional(trackingString),
  ttclid: t.Optional(trackingString),
  gclid: t.Optional(trackingString),
  gbraid: t.Optional(trackingString),
  wbraid: t.Optional(trackingString),
  referrer: t.Optional(trackingString),
  landingPath: t.Optional(trackingString),
  capturedAt: trackingString,
}, { additionalProperties: false })

// The parser sanitizes this before validation; the schema documents the shape.
const trackingContext = t.Object({
  consentId: t.Optional(trackingString),
  posthogDistinctId: t.Optional(trackingString),
  firstTouch: t.Optional(trackingTouch),
  lastTouch: t.Optional(trackingTouch),
  fbp: t.Optional(trackingString),
  fbc: t.Optional(trackingString),
  ttp: t.Optional(trackingString),
}, { additionalProperties: false })

const placeOrderBody = t.Object({
  quoteToken: t.String({ minLength: 1, maxLength: 8192 }),
  paymentMethod: t.Union([t.Literal('cod'), t.Literal('stripe')]),
  stripePaymentMethod: t.Optional(t.Union([t.Literal('card'), t.Literal('promptpay')])),
  contact: t.Object({
    email: t.String({ format: 'email', minLength: 3, maxLength: 320 }),
  }, { additionalProperties: false }),
  billingAddress: address,
  shippingAddress: t.Optional(address),
  tracking: t.Optional(trackingContext),
}, { additionalProperties: false })

const idempotencyHeaders = t.Object({
  'idempotency-key': t.String({ pattern: '^[!-~]{1,128}$' }),
})

export const checkoutModels = {
  'checkout.quoteBody': quoteBody,
  'checkout.quoteLine': quoteLine,
  'checkout.quote': quote,
  'checkout.placeOrderBody': placeOrderBody,
  'checkout.idempotencyHeaders': idempotencyHeaders,
}
