import { t } from 'elysia'

const satang = t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const count = t.Integer({ minimum: 0 })
const range = t.Union([t.Literal('7d'), t.Literal('30d'), t.Literal('90d')])
const orderStatus = t.Union([
  t.Literal('pending_payment'),
  t.Literal('placed'),
  t.Literal('processing'),
  t.Literal('packed'),
  t.Literal('shipped'),
  t.Literal('delivered'),
  t.Literal('cancelled'),
])

export const dashboardModels = {
  'dashboard.query': t.Object({
    // Reporting window in Asia/Bangkok days, including today. Defaults to 30d.
    range: t.Optional(range),
  }, { additionalProperties: false }),
  'dashboard.overview': t.Object({
    range,
    from: t.String({ format: 'date-time', description: 'Inclusive start of the window.' }),
    to: t.String({ format: 'date-time', description: 'Exclusive end of the window (start of tomorrow in Asia/Bangkok).' }),
    summary: t.Object({
      revenueSatang: satang,
      previousRevenueSatang: satang,
      orderCount: count,
      previousOrderCount: count,
      averageOrderValueSatang: satang,
    }, { additionalProperties: false }),
    backlog: t.Object({
      pendingPayment: count,
      placed: count,
      processing: count,
      packed: count,
    }, { additionalProperties: false }),
    daily: t.Array(t.Object({
      date: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
      orderCount: count,
      revenueSatang: satang,
    }, { additionalProperties: false })),
    recentOrders: t.Array(t.Object({
      id: t.String({ format: 'uuid' }),
      orderNumber: t.String(),
      recipientName: t.String(),
      status: orderStatus,
      paymentMethod: t.String(),
      totalSatang: satang,
      createdAt: t.String({ format: 'date-time' }),
    }, { additionalProperties: false })),
  }, { additionalProperties: false }),
}

export type DashboardOverview = typeof dashboardModels['dashboard.overview']['static']
