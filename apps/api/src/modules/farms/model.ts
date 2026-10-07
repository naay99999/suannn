import { t } from 'elysia'

const uuid = t.String({ format: 'uuid' })
const nullable = (max: number) => t.Union([t.String({ maxLength: max }), t.Null()])
const status = t.Union([t.Literal('draft'), t.Literal('published'), t.Literal('archived')])
const imageUrl = t.Union([t.String({ minLength: 1, maxLength: 2048, format: 'uri', pattern: '^https://' }), t.Null()])
const summary = t.Object({
  id: uuid, slug: t.String({ maxLength: 100 }), name: t.String({ maxLength: 160 }),
  farmerName: nullable(160), province: nullable(100), district: nullable(100), summary: nullable(300),
  coverImageUrl: imageUrl, coverImageAlt: nullable(200), isDemo: t.Boolean(),
}, { additionalProperties: false })
const detail = t.Object({
  ...summary.properties,
  story: nullable(5000), growingPractices: nullable(5000),
  portraitImageUrl: imageUrl, portraitImageAlt: nullable(200),
}, { additionalProperties: false })
const adminFarm = t.Object({
  ...detail.properties, status, createdAt: t.Date(), updatedAt: t.Date(),
  publishedAt: t.Union([t.Date(), t.Null()]), archivedAt: t.Union([t.Date(), t.Null()]),
}, { additionalProperties: false })
const page = <T extends ReturnType<typeof t.Object>>(item: T) => t.Object({
  items: t.Array(item), nextCursor: t.Union([t.String(), t.Null()]),
}, { additionalProperties: false })
const listQuery = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
}, { additionalProperties: false })
const adminQuery = t.Object({
  status: t.Optional(status),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
}, { additionalProperties: false })
const slugParams = t.Object({ slug: t.String({ minLength: 1, maxLength: 100, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }) }, { additionalProperties: false })
const idParams = t.Object({ id: uuid }, { additionalProperties: false })
const createBody = t.Object({
  slug: t.String({ minLength: 1, maxLength: 100 }), name: t.String({ minLength: 1, maxLength: 160 }),
  farmerName: t.Optional(nullable(160)), province: t.Optional(nullable(100)), district: t.Optional(nullable(100)),
  summary: t.Optional(nullable(300)), story: t.Optional(nullable(5000)), growingPractices: t.Optional(nullable(5000)),
  coverImageUrl: t.Optional(imageUrl), coverImageAlt: t.Optional(nullable(200)),
  portraitImageUrl: t.Optional(imageUrl), portraitImageAlt: t.Optional(nullable(200)),
}, { additionalProperties: false })
const updateBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 160 })), farmerName: t.Optional(nullable(160)),
  province: t.Optional(nullable(100)), district: t.Optional(nullable(100)), summary: t.Optional(nullable(300)),
  story: t.Optional(nullable(5000)), growingPractices: t.Optional(nullable(5000)),
  coverImageUrl: t.Optional(imageUrl), coverImageAlt: t.Optional(nullable(200)),
  portraitImageUrl: t.Optional(imageUrl), portraitImageAlt: t.Optional(nullable(200)),
}, { additionalProperties: false, minProperties: 1 })
const productFarmBody = t.Object({ farmIds: t.Array(uuid, { maxItems: 20 }) }, { additionalProperties: false })

export const farmModels = {
  'farm.summary': summary,
  'farm.detail': detail,
  'farm.admin': adminFarm,
  'farm.storePage': page(summary),
  'farm.adminPage': page(adminFarm),
  'farm.listQuery': listQuery,
  'farm.adminQuery': adminQuery,
  'farm.slugParams': slugParams,
  'farm.idParams': idParams,
  'farm.createBody': createBody,
  'farm.updateBody': updateBody,
  'farm.productBody': productFarmBody,
}
