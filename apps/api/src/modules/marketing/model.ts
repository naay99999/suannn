import { t } from 'elysia'

const platform = t.Union([t.Literal('meta'), t.Literal('tiktok'), t.Literal('google')])
const nullableNumber = t.Union([t.Number(), t.Null()])
const nullableString = t.Union([t.String(), t.Null()])
const dateRange = t.Object({ from: t.String(), to: t.String() }, { additionalProperties: false })

const campaignRow = t.Object({
  platform: t.Union([platform, t.Null()]),
  utmSource: nullableString,
  campaignId: t.String(),
  campaignName: nullableString,
  spendSatang: nullableNumber,
  orders: t.Number(),
  revenueSatang: t.Number(),
  roas: nullableNumber,
  costPerOrderSatang: nullableNumber,
  verdict: t.Union([
    t.Literal('profit'), t.Literal('breakeven'), t.Literal('loss'), t.Literal('no_sales'), t.Null(),
  ]),
}, { additionalProperties: false })

const warning = t.Object({
  code: t.Union([
    t.Literal('NON_THB_CURRENCY'),
    t.Literal('NO_PLATFORM_CONFIGURED'),
    t.Literal('SPEND_DATA_STARTS_LATE'),
    t.Literal('NON_BANGKOK_TIMEZONE'),
  ]),
  platform: t.Optional(platform),
  date: t.Optional(t.String()),
}, { additionalProperties: false })

const totals = {
  spendSatang: t.Number(),
  revenueSatang: t.Number(),
  orders: t.Number(),
  roas: nullableNumber,
}

export const marketingModels = {
  'marketing.overviewQuery': t.Object({ from: t.Optional(t.String()), to: t.Optional(t.String()) }),
  'marketing.overview': t.Object({
    range: dateRange,
    previousRange: dateRange,
    breakEvenRoas: t.Number(),
    summary: t.Object({
      ...totals,
      costPerOrderSatang: nullableNumber,
      previous: t.Object(totals, { additionalProperties: false }),
      unmatched: t.Object({ revenueSatang: t.Number(), orders: t.Number() }, { additionalProperties: false }),
      nonAdOrders: t.Number(),
    }, { additionalProperties: false }),
    campaigns: t.Array(campaignRow),
    warnings: t.Array(warning),
  }, { additionalProperties: false }),
  'marketing.settings': t.Object({
    marginPercent: t.Number(),
    version: t.Integer({ minimum: 1 }),
    updatedAt: t.String(),
  }, { additionalProperties: false }),
  // The service re-checks range and precision; a schema failure is remapped to INVALID_MARKETING_SETTINGS.
  'marketing.updateSettingsBody': t.Object({
    marginPercent: t.Number(),
    version: t.Integer(),
  }, { additionalProperties: false }),
  'marketing.syncResponse': t.Object({
    results: t.Array(t.Object({
      platform,
      status: t.Union([
        t.Literal('succeeded'), t.Literal('failed'), t.Literal('already_running'), t.Literal('not_configured'),
      ]),
      errorCode: t.Optional(t.String()),
    }, { additionalProperties: false })),
  }, { additionalProperties: false }),
  'marketing.templates': t.Object({
    templates: t.Array(t.Object({
      platform,
      where: t.String(),
      template: t.String(),
    }, { additionalProperties: false })),
  }, { additionalProperties: false }),
} as const
