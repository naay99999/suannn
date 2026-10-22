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
          products: event.contents.map((item) => ({
            product_id: item.productId, variant_id: item.variantId, quantity: item.quantity, price: item.unitPrice,
          })),
          ...(event.analyticsConsent ? {} : { $process_person_profile: false }),
        },
      })
    },
  }
}
