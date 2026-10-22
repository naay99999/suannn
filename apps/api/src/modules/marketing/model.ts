import { t } from 'elysia'
import type { MarketingOverview } from './metrics/service'
import type { UtmTemplate } from './templates'

// Unsafe over Any compiles as an unchecked value while keeping the inferred type.
// Settings input is validated by the service so every bad value yields INVALID_MARKETING_SETTINGS;
// Unsafe schemas keep the typed client accurate without a second, differently coded validation layer.
export const marketingModels = {
  'marketing.overviewQuery': t.Object({ from: t.Optional(t.String()), to: t.Optional(t.String()) }),
  'marketing.overview': t.Unsafe<MarketingOverview>(t.Any()),
  'marketing.settings': t.Object({
    marginPercent: t.Number(),
    version: t.Integer({ minimum: 1 }),
    updatedAt: t.String(),
  }, { additionalProperties: false }),
  'marketing.updateSettingsBody': t.Unsafe<{ marginPercent: number, version: number }>(t.Any()),
  'marketing.syncResponse': t.Object({
    results: t.Array(t.Object({
      platform: t.Union([t.Literal('meta'), t.Literal('tiktok'), t.Literal('google')]),
      status: t.Union([t.Literal('succeeded'), t.Literal('failed'), t.Literal('already_running'), t.Literal('not_configured')]),
    }, { additionalProperties: true })),
  }),
  'marketing.templates': t.Unsafe<{ templates: UtmTemplate[] }>(t.Any()),
} as const
