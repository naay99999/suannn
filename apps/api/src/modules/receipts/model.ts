import { t } from 'elysia'

const optionalText = (maxLength: number) => t.Union([t.String({ maxLength }), t.Null()])

export const receiptSettingsFields = [
  'name', 'taxId', 'branch', 'addressLine1', 'addressLine2',
  'subdistrict', 'district', 'province', 'postalCode', 'phone',
] as const

export const receiptSettingsModels = {
  'receiptSettings.response': t.Object({
    id: t.Integer({ minimum: 1, maximum: 1 }),
    name: t.Union([t.String(), t.Null()]),
    taxId: t.Union([t.String(), t.Null()]),
    branch: t.Union([t.String(), t.Null()]),
    addressLine1: t.Union([t.String(), t.Null()]),
    addressLine2: t.Union([t.String(), t.Null()]),
    subdistrict: t.Union([t.String(), t.Null()]),
    district: t.Union([t.String(), t.Null()]),
    province: t.Union([t.String(), t.Null()]),
    postalCode: t.Union([t.String(), t.Null()]),
    phone: t.Union([t.String(), t.Null()]),
    vatRateBasisPoints: t.Integer({ minimum: 0, maximum: 10000 }),
    complete: t.Boolean(),
    version: t.Integer({ minimum: 1 }),
    updatedAt: t.Date(),
  }, { additionalProperties: false }),
  'receiptSettings.updateBody': t.Object({
    name: optionalText(200),
    taxId: optionalText(32),
    branch: optionalText(16),
    addressLine1: optionalText(300),
    addressLine2: optionalText(300),
    subdistrict: optionalText(120),
    district: optionalText(120),
    province: optionalText(120),
    postalCode: optionalText(16),
    phone: optionalText(40),
  }, { additionalProperties: false }),
}
