import { MAX_EVENT_AGE_MS } from '../purchase'
import type { TrackingAdapter, TrackingConfigOf } from '../types'
import { postJson } from './http'

const META_GRAPH_API_VERSION = 'v23.0'

export function createMetaAdapter(
  config: TrackingConfigOf<'meta'>,
  fetchImpl: typeof fetch = fetch,
): TrackingAdapter {
  // access_token travels as a query parameter; this URL is never logged or put in errors.
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(config.pixelId)}/events`
    + `?access_token=${encodeURIComponent(config.accessToken)}`
  return {
    destination: 'meta',
    maxEventAgeMs: MAX_EVENT_AGE_MS.meta,
    async send(event) {
      const { user } = event
      const userData: Record<string, unknown> = {}
      if (user.emailSha256) userData.em = [user.emailSha256]
      if (user.phoneSha256) userData.ph = [user.phoneSha256]
      if (user.clientIp) userData.client_ip_address = user.clientIp
      if (user.userAgent) userData.client_user_agent = user.userAgent
      if (user.fbp) userData.fbp = user.fbp
      if (user.fbc) userData.fbc = user.fbc

      await postJson(fetchImpl, 'META', url, {
        data: [{
          event_name: 'Purchase',
          event_id: event.eventId,
          event_time: Math.floor(event.occurredAt.getTime() / 1000),
          action_source: 'website',
          user_data: userData,
          custom_data: {
            currency: event.currency,
            value: event.value,
            contents: event.contents.map((item) => ({ id: item.variantId, quantity: item.quantity, item_price: item.unitPrice })),
            content_type: 'product',
          },
        }],
        ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
      })
    },
  }
}
