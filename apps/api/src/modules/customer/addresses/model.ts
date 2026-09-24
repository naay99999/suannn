import { t } from 'elysia'

const requiredText = (maxLength: number) => t.String({ minLength: 1, maxLength })

const fields = {
  label: requiredText(60),
  recipientName: requiredText(100),
  phone: t.String({ pattern: '^[0-9]{9,10}$' }),
  addressLine1: requiredText(200),
  addressLine2: t.Union([t.String({ maxLength: 200 }), t.Null()]),
  subdistrict: requiredText(100),
  district: requiredText(100),
  province: requiredText(100),
  postalCode: t.String({ pattern: '^[0-9]{5}$' }),
  country: t.Optional(t.Literal('TH')),
}

export const customerAddressModels = {
  'customerAddress.createBody': t.Object({ ...fields, addressLine2: t.Optional(fields.addressLine2) }, { additionalProperties: false }),
  'customerAddress.updateBody': t.Partial(t.Object(fields, { additionalProperties: false })),
  'customerAddress.defaultBody': t.Object({ kind: t.Union([t.Literal('shipping'), t.Literal('billing')]) }, { additionalProperties: false }),
  'customerAddress.address': t.Object({
    id: t.String(), label: t.String(), recipientName: t.String(), phone: t.String(),
    addressLine1: t.String(), addressLine2: t.Union([t.String(), t.Null()]),
    subdistrict: t.String(), district: t.String(), province: t.String(), postalCode: t.String(),
    country: t.Literal('TH'), isDefaultShipping: t.Boolean(), isDefaultBilling: t.Boolean(),
    createdAt: t.Date(), updatedAt: t.Date(),
  }, { additionalProperties: false }),
  'customerAddress.list': t.Object({ items: t.Array(t.Ref('customerAddress.address')) }),
}
