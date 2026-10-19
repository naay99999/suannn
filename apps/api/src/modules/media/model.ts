import { t } from 'elysia'

const uuid = t.String({ format: 'uuid' })

const image = t.Object({
  id: uuid,
  url: t.String(),
  thumbUrl: t.String(),
  alt: t.Union([t.String({ maxLength: 200 }), t.Null()]),
  width: t.Integer(),
  height: t.Integer(),
}, { additionalProperties: false })
const item = t.Object({
  ...image.properties,
  byteSize: t.Integer(),
  originalFilename: t.String(),
  createdAt: t.Date(),
  usage: t.Object({ products: t.Integer(), farms: t.Integer() }, { additionalProperties: false }),
}, { additionalProperties: false })
const detail = t.Object({
  ...item.properties,
  usedBy: t.Object({
    products: t.Array(t.Object({ id: uuid, name: t.String(), slug: t.String() }, { additionalProperties: false })),
    farms: t.Array(t.Object({
      id: uuid, name: t.String(), slot: t.Union([t.Literal('cover'), t.Literal('portrait')]),
    }, { additionalProperties: false })),
  }, { additionalProperties: false }),
}, { additionalProperties: false })
const page = t.Object({
  items: t.Array(item), nextCursor: t.Union([t.String(), t.Null()]),
}, { additionalProperties: false })
const listQuery = t.Object({
  q: t.Optional(t.String({ maxLength: 200 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 60, multipleOf: 1 })),
}, { additionalProperties: false })
const idParams = t.Object({ id: uuid }, { additionalProperties: false })
const uploadBody = t.Object({
  file: t.File({ maxSize: '10m' }),
  alt: t.Optional(t.String({ maxLength: 200 })),
}, { additionalProperties: false })
const updateBody = t.Object({
  alt: t.Union([t.String({ maxLength: 200 }), t.Null()]),
}, { additionalProperties: false })

export const mediaModels = {
  'media.image': image,
  'media.item': item,
  'media.detail': detail,
  'media.page': page,
  'media.listQuery': listQuery,
  'media.idParams': idParams,
  'media.uploadBody': uploadBody,
  'media.updateBody': updateBody,
}
