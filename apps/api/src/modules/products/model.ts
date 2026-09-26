import { t } from 'elysia'

const uuid = t.String({ format: 'uuid' })
const nullableString = t.Union([t.String(), t.Null()])
const nullableDate = t.Union([t.Date(), t.Null()])
const category = t.Union([t.Literal('fresh'), t.Literal('processed')])
const status = t.Union([t.Literal('draft'), t.Literal('published'), t.Literal('archived')])
const productSlug = t.String({ minLength: 1, maxLength: 100, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
const sku = t.String({ minLength: 1, maxLength: 64, pattern: '^[A-Z0-9._-]+$' })
const inputSlug = t.String({ minLength: 1, maxLength: 100 })
const inputSku = t.String({ minLength: 1, maxLength: 64 })
const imageUrl = t.Union([
  t.String({ minLength: 1, maxLength: 2048, format: 'uri', pattern: '^https://' }),
  t.Null(),
])

const productIdentity = {
  id: uuid,
  slug: productSlug,
  name: t.String({ maxLength: 160 }),
  englishName: t.Union([t.String({ maxLength: 160 }), t.Null()]),
  category,
  imageUrl,
  imageAlt: t.Union([t.String({ maxLength: 200 }), t.Null()]),
}

const storeProductSummary = t.Object({
  ...productIdentity,
  minPriceSatang: t.Integer({ minimum: 1, maximum: 1_000_000_000 }),
}, { additionalProperties: false })

const storeVariant = t.Object({
  id: uuid,
  name: t.String({ maxLength: 120 }),
  unit: t.String({ maxLength: 40 }),
  priceSatang: t.Integer({ minimum: 1, maximum: 1_000_000_000 }),
  displayOrder: t.Integer({ minimum: 0, maximum: 1_000_000 }),
  canPurchase: t.Boolean({ description: 'Application-level eligibility hint from salesEnabled; it does not confirm stock availability.' }),
}, { additionalProperties: false })

const storeProductDetail = t.Object({
  ...storeProductSummary.properties,
  description: t.Union([t.String({ maxLength: 5000 }), t.Null()]),
  originStory: t.Union([t.String({ maxLength: 5000 }), t.Null()]),
  storageInstructions: t.Union([t.String({ maxLength: 5000 }), t.Null()]),
  variants: t.Array(storeVariant),
}, { additionalProperties: false })

const adminProductSummary = t.Object({
  ...productIdentity,
  status,
  createdAt: t.Date(),
  updatedAt: t.Date(),
  publishedAt: nullableDate,
  archivedAt: nullableDate,
}, { additionalProperties: false })

const adminVariant = t.Object({
  id: uuid,
  productId: uuid,
  sku,
  name: t.String({ maxLength: 120 }),
  unit: t.String({ maxLength: 40 }),
  priceSatang: t.Integer({ minimum: 1, maximum: 1_000_000_000 }),
  salesEnabled: t.Boolean(),
  displayOrder: t.Integer({ minimum: 0, maximum: 1_000_000 }),
  createdAt: t.Date(),
  updatedAt: t.Date(),
  archivedAt: nullableDate,
}, { additionalProperties: false })

const adminProductFields = {
  ...productIdentity,
  description: t.Union([t.String({ maxLength: 5000 }), t.Null()]),
  originStory: t.Union([t.String({ maxLength: 5000 }), t.Null()]),
  storageInstructions: t.Union([t.String({ maxLength: 5000 }), t.Null()]),
  status,
  createdAt: t.Date(),
  updatedAt: t.Date(),
  publishedAt: nullableDate,
  archivedAt: nullableDate,
}

const adminProduct = t.Object({
  ...adminProductFields,
  variants: t.Array(adminVariant),
}, { additionalProperties: false })

const adminProductMutation = t.Object(adminProductFields, { additionalProperties: false })

const productPage = <T extends ReturnType<typeof t.Object>>(item: T) => t.Object({
  items: t.Array(item),
  nextCursor: nullableString,
}, { additionalProperties: false })

const productIdParams = t.Object({ id: uuid }, { additionalProperties: false })
const productVariantParams = t.Object({ id: uuid, variantId: uuid }, { additionalProperties: false })
const storeSlugParams = t.Object({ slug: productSlug }, { additionalProperties: false })

const storeQuery = t.Object({
  q: t.Optional(t.String({ maxLength: 200 })),
  category: t.Optional(category),
  sort: t.Optional(t.Union([t.Literal('newest'), t.Literal('price-asc'), t.Literal('price-desc')])),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
}, { additionalProperties: false })

const adminQuery = t.Object({
  q: t.Optional(t.String({ maxLength: 200 })),
  status: t.Optional(status),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
}, { additionalProperties: false })

const createProductBody = t.Object({
  slug: inputSlug,
  name: t.String({ minLength: 1, maxLength: 160 }),
  category,
  englishName: t.Optional(t.Union([t.String({ maxLength: 160 }), t.Null()])),
  description: t.Optional(t.Union([t.String({ maxLength: 5000 }), t.Null()])),
  originStory: t.Optional(t.Union([t.String({ maxLength: 5000 }), t.Null()])),
  storageInstructions: t.Optional(t.Union([t.String({ maxLength: 5000 }), t.Null()])),
  imageUrl: t.Optional(imageUrl),
  imageAlt: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
}, { additionalProperties: false })

const updateProductBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 160 })),
  category: t.Optional(category),
  englishName: t.Optional(t.Union([t.String({ maxLength: 160 }), t.Null()])),
  description: t.Optional(t.Union([t.String({ maxLength: 5000 }), t.Null()])),
  originStory: t.Optional(t.Union([t.String({ maxLength: 5000 }), t.Null()])),
  storageInstructions: t.Optional(t.Union([t.String({ maxLength: 5000 }), t.Null()])),
  imageUrl: t.Optional(imageUrl),
  imageAlt: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
}, { additionalProperties: false, minProperties: 1 })

const createVariantBody = t.Object({
  sku: inputSku,
  name: t.String({ minLength: 1, maxLength: 120 }),
  unit: t.String({ minLength: 1, maxLength: 40 }),
  priceSatang: t.Integer({ minimum: 1, maximum: 1_000_000_000 }),
  salesEnabled: t.Optional(t.Boolean()),
  displayOrder: t.Optional(t.Integer({ minimum: 0, maximum: 1_000_000 })),
}, { additionalProperties: false })

const updateVariantBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  unit: t.Optional(t.String({ minLength: 1, maxLength: 40 })),
  priceSatang: t.Optional(t.Integer({ minimum: 1, maximum: 1_000_000_000 })),
  salesEnabled: t.Optional(t.Boolean()),
  displayOrder: t.Optional(t.Integer({ minimum: 0, maximum: 1_000_000 })),
}, { additionalProperties: false, minProperties: 1 })

export const productModels = {
  'product.storeSummary': storeProductSummary,
  'product.storeDetail': storeProductDetail,
  'product.storePage': productPage(storeProductSummary),
  'product.adminSummary': adminProductSummary,
  'product.adminVariant': adminVariant,
  'product.adminProduct': adminProduct,
  'product.adminProductMutation': adminProductMutation,
  'product.adminPage': productPage(adminProductSummary),
  'product.storeQuery': storeQuery,
  'product.adminQuery': adminQuery,
  'product.storeSlugParams': storeSlugParams,
  'product.idParams': productIdParams,
  'product.variantParams': productVariantParams,
  'product.createBody': createProductBody,
  'product.updateBody': updateProductBody,
  'product.createVariantBody': createVariantBody,
  'product.updateVariantBody': updateVariantBody,
}
