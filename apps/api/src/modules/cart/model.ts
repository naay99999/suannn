import { t } from 'elysia'

const uuid = t.String({ format: 'uuid' })
const nullableUuid = t.Union([uuid, t.Null()])
const nullableString = t.Union([t.String(), t.Null()])
const issue = t.Union([
  t.Literal('PRODUCT_UNAVAILABLE'),
  t.Literal('VARIANT_UNAVAILABLE'),
  t.Literal('OUT_OF_STOCK'),
])

const line = t.Object({
  variantId: uuid,
  productId: nullableUuid,
  productSlug: nullableString,
  productName: nullableString,
  productImageUrl: nullableString,
  productImageAlt: nullableString,
  variantName: nullableString,
  unit: nullableString,
  quantity: t.Integer({ minimum: 1, maximum: 99 }),
  priceSatang: t.Union([t.Integer({ minimum: 1, maximum: 1_000_000_000 }), t.Null()]),
  canPurchase: t.Boolean(),
  issues: t.Array(issue),
}, { additionalProperties: false })

const detail = t.Object({
  cartVersion: t.Integer({ minimum: 0 }),
  lines: t.Array(line),
}, { additionalProperties: false })

const setItemBody = t.Object({
  quantity: t.Integer({ minimum: 1, maximum: 99 }),
}, { additionalProperties: false })

const variantParams = t.Object({ variantId: uuid }, { additionalProperties: false })

const mergeResponse = t.Object({
  cart: detail,
  skipped: t.Array(t.Object({
    variantId: uuid,
    code: t.Union([
      t.Literal('PRODUCT_UNAVAILABLE'),
      t.Literal('VARIANT_UNAVAILABLE'),
      t.Literal('OUT_OF_STOCK'),
      t.Literal('CART_LINE_LIMIT_REACHED'),
    ]),
  }, { additionalProperties: false })),
}, { additionalProperties: false })

const emptyBody = t.Object({}, { additionalProperties: false })

export const cartModels = {
  'cart.detail': detail,
  'cart.setItemBody': setItemBody,
  'cart.variantParams': variantParams,
  'cart.mergeBody': emptyBody,
  'cart.mergeResponse': mergeResponse,
}
