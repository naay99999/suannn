import { t } from 'elysia'

export const trackingStatusModels = {
  'trackingStatus.response': t.Object({
    destinations: t.Array(t.Object({
      destination: t.Union([t.Literal('posthog'), t.Literal('meta'), t.Literal('tiktok'), t.Literal('google_ads')]),
      configured: t.Boolean(),
      lastSuccessAt: t.Union([t.String({ format: 'date-time' }), t.Null()]),
      failures24h: t.Integer({ minimum: 0 }),
      lastErrorCode: t.Union([t.String(), t.Null()]),
    }, { additionalProperties: false })),
    adSpend: t.Array(t.Object({
      platform: t.Union([t.Literal('meta'), t.Literal('tiktok'), t.Literal('google')]),
      configured: t.Boolean(),
      lastSuccessAt: t.Union([t.String({ format: 'date-time' }), t.Null()]),
      lastRunStatus: t.Union([t.Literal('succeeded'), t.Literal('failed'), t.Literal('running'), t.Null()]),
      lastErrorCode: t.Union([t.String(), t.Null()]),
      earliestDate: t.Union([t.String(), t.Null()]),
    }, { additionalProperties: false })),
  }, { additionalProperties: false }),
}
