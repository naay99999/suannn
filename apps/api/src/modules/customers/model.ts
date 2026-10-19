import { t } from 'elysia'

const satang = t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const orderStatus = t.Union([
  t.Literal('pending_payment'),
  t.Literal('placed'),
  t.Literal('processing'),
  t.Literal('packed'),
  t.Literal('shipped'),
  t.Literal('delivered'),
  t.Literal('cancelled'),
])

export const customerIdPattern = '^[A-Za-z0-9_-]{1,128}$'

export const adminCustomerModels = {
  'adminCustomer.idParams': t.Object({ customerId: t.String({ pattern: customerIdPattern }) }, { additionalProperties: false }),
  'adminCustomer.detail': t.Object({
    id: t.String(),
    name: t.String(),
    email: t.String(),
    emailVerified: t.Boolean(),
    banned: t.Boolean(),
    createdAt: t.String({ format: 'date-time' }),
    stats: t.Object({
      orderCount: t.Integer({ minimum: 0 }),
      spentSatang: t.Integer({ minimum: 0, description: 'Total of orders that became sales, excluding pending_payment and cancelled orders.' }),
      lastOrderAt: t.Union([t.String({ format: 'date-time' }), t.Null()]),
    }, { additionalProperties: false }),
    addresses: t.Array(t.Object({
      id: t.String(),
      label: t.String(),
      recipientName: t.String(),
      phone: t.String(),
      addressLine1: t.String(),
      addressLine2: t.Union([t.String(), t.Null()]),
      subdistrict: t.String(),
      district: t.String(),
      province: t.String(),
      postalCode: t.String(),
      isDefaultShipping: t.Boolean(),
      isDefaultBilling: t.Boolean(),
    }, { additionalProperties: false })),
    recentOrders: t.Array(t.Object({
      id: t.String({ format: 'uuid' }),
      orderNumber: t.String(),
      status: orderStatus,
      paymentMethod: t.String(),
      totalSatang: satang,
      createdAt: t.String({ format: 'date-time' }),
    }, { additionalProperties: false })),
  }, { additionalProperties: false }),
}

export type AdminCustomerDetail = typeof adminCustomerModels['adminCustomer.detail']['static']
