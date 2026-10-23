import { t } from 'elysia'

const nullable = <T extends ReturnType<typeof t.Integer | typeof t.String>>(schema: T) => t.Union([schema, t.Null()])
const optionalNullable = <T extends ReturnType<typeof t.Integer | typeof t.String>>(schema: T) => t.Optional(nullable(schema))

// Bodies only check types: ranges and shapes per kind are validated by the service so that every
// semantic failure answers 400 INVALID_DISCOUNT.
const inputFields = {
  code: t.String({ maxLength: 64 }),
  name: t.String({ maxLength: 200 }),
  kind: t.Union([t.Literal('percent'), t.Literal('fixed'), t.Literal('free_shipping')]),
  percentOff: optionalNullable(t.Integer()),
  amountOffSatang: optionalNullable(t.Integer()),
  maxDiscountSatang: optionalNullable(t.Integer()),
  minSubtotalSatang: optionalNullable(t.Integer()),
  minQuantity: optionalNullable(t.Integer()),
  eligibleCategories: t.Optional(t.Array(t.String({ maxLength: 32 }), { maxItems: 8 })),
  eligibleProductIds: t.Optional(t.Array(t.String({ maxLength: 64 }), { maxItems: 500 })),
  startsAt: optionalNullable(t.String({ maxLength: 40 })),
  endsAt: optionalNullable(t.String({ maxLength: 40 })),
  usageLimit: optionalNullable(t.Integer()),
  perCustomerLimit: optionalNullable(t.Integer()),
  allowedEmails: t.Optional(t.Array(t.String({ maxLength: 400 }), { maxItems: 2000 })),
  firstOrderOnly: t.Optional(t.Boolean()),
  active: t.Optional(t.Boolean()),
}

const status = t.Union([
  t.Literal('paused'), t.Literal('scheduled'), t.Literal('expired'), t.Literal('used_up'), t.Literal('active'),
])

const adminFields = {
  id: t.String(),
  code: t.String(),
  name: t.String(),
  kind: t.Union([t.Literal('percent'), t.Literal('fixed'), t.Literal('free_shipping')]),
  percentOff: nullable(t.Integer()),
  amountOffSatang: nullable(t.Integer()),
  maxDiscountSatang: nullable(t.Integer()),
  minSubtotalSatang: nullable(t.Integer()),
  minQuantity: nullable(t.Integer()),
  eligibleCategories: t.Array(t.String()),
  eligibleProductIds: t.Array(t.String()),
  startsAt: nullable(t.String()),
  endsAt: nullable(t.String()),
  usageLimit: nullable(t.Integer()),
  perCustomerLimit: nullable(t.Integer()),
  allowedEmails: t.Array(t.String()),
  firstOrderOnly: t.Boolean(),
  active: t.Boolean(),
  version: t.Integer(),
  createdAt: t.String(),
  updatedAt: t.String(),
  status,
  uses: t.Integer({ description: 'Non-cancelled orders that used the code.' }),
  locked: t.Boolean({ description: 'True once any order, in any status, references the code; code and kind are then immutable and the code cannot be deleted.' }),
  revenueSatang: t.Integer(),
  discountGivenSatang: t.Integer(),
}

export const discountModels = {
  'discount.idParams': t.Object({ discountId: t.String({ format: 'uuid' }) }, { additionalProperties: false }),
  'discount.createBody': t.Object(inputFields, { additionalProperties: false }),
  'discount.updateBody': t.Object({ ...inputFields, version: t.Integer({ minimum: 1 }) }, { additionalProperties: false }),
  'discount.admin': t.Object(adminFields, { additionalProperties: false }),
  'discount.adminDetail': t.Object({
    ...adminFields,
    recentOrders: t.Array(t.Object({
      id: t.String(),
      orderNumber: t.String(),
      createdAt: t.String(),
      totalSatang: t.Integer(),
      discountSatang: t.Integer(),
    }, { additionalProperties: false })),
  }, { additionalProperties: false }),
  'discount.adminList': t.Object({ items: t.Array(t.Object(adminFields, { additionalProperties: false })) }, { additionalProperties: false }),
}
