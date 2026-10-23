import { MAX_EVENT_AGE_MS } from '../purchase'
import type { TrackingAdapter, TrackingConfigOf } from '../types'
import { postJson } from './http'

export function createPostHogAdapter(
  config: TrackingConfigOf<'posthog'>,
  fetchImpl: typeof fetch = fetch,
): TrackingAdapter {
  const url = `${config.host.replace(/\/+$/, '')}/i/v0/e/`
  return {
    destination: 'posthog',
    maxEventAgeMs: MAX_EVENT_AGE_MS.posthog,
    async send(event) {
      await postJson(fetchImpl, 'POSTHOG', url, {
        api_key: config.apiKey,
        // PostHog dedupes on uuid; order ids are UUIDs, so retries never double-count.
        uuid: event.eventId,
        event: 'purchase',
        distinct_id: event.posthogDistinctId ?? `order:${event.eventId}`,
        timestamp: event.occurredAt.toISOString(),
        properties: {
          order_id: event.eventId,
          order_number: event.orderNumber,
          revenue: event.value,
          value: event.value,
          shipping: event.shipping,
          currency: event.currency,
          ...(event.coupon ? { coupon: event.coupon } : {}),
          products: event.contents.map((item) => ({
            product_id: item.productId, variant_id: item.variantId, quantity: item.quantity, price: item.unitPrice,
          })),
          ...(event.attribution.utmSource ? { utm_source: event.attribution.utmSource } : {}),
          ...(event.attribution.utmMedium ? { utm_medium: event.attribution.utmMedium } : {}),
          ...(event.attribution.utmCampaign ? { utm_campaign: event.attribution.utmCampaign } : {}),
          ...(event.attribution.utmContent ? { utm_content: event.attribution.utmContent } : {}),
          ...(event.analyticsConsent ? {} : { $process_person_profile: false }),
        },
      })
    },
  }
}
