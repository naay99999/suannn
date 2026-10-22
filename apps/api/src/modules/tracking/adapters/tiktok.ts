import { TrackingDeliveryError } from '../types'
import { MAX_EVENT_AGE_MS } from '../purchase'
import type { TrackingAdapter, TrackingConfigOf } from '../types'
import { postJson } from './http'

const TIKTOK_EVENTS_API_VERSION = 'v1.3'
const TIKTOK_EVENTS_URL = `https://business-api.tiktok.com/open_api/${TIKTOK_EVENTS_API_VERSION}/event/track/`
// Application-level codes TikTok returns inside an HTTP 200 body.
const TIKTOK_AUTH_CODES = new Set([40001, 40104, 40105])

export function createTikTokAdapter(
  config: TrackingConfigOf<'tiktok'>,
  fetchImpl: typeof fetch = fetch,
): TrackingAdapter {
  return {
    destination: 'tiktok',
    maxEventAgeMs: MAX_EVENT_AGE_MS.tiktok,
    async send(event) {
      const { user } = event
      const userData: Record<string, string> = {}
      if (user.emailSha256) userData.email = user.emailSha256
      if (user.phoneSha256) userData.phone = user.phoneSha256
      if (user.clientIp) userData.ip = user.clientIp
      if (user.userAgent) userData.user_agent = user.userAgent
      if (user.ttclid) userData.ttclid = user.ttclid
      if (user.ttp) userData.ttp = user.ttp

      const response = await postJson(fetchImpl, 'TIKTOK', TIKTOK_EVENTS_URL, {
        event_source: 'web',
        event_source_id: config.pixelCode,
        ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
        data: [{
          event: 'Purchase',
          event_id: event.eventId,
          event_time: Math.floor(event.occurredAt.getTime() / 1000),
          user: userData,
          properties: {
            currency: event.currency,
            value: event.value,
            content_type: 'product',
            contents: event.contents.map((item) => ({
              content_id: item.variantId, quantity: item.quantity, price: item.unitPrice,
            })),
          },
        }],
      }, { 'Access-Token': config.accessToken })

      const result = await response.json().catch(() => null) as { code?: unknown } | null
      const code = typeof result?.code === 'number' ? result.code : 0
      if (code === 0) return
      if (TIKTOK_AUTH_CODES.has(code)) throw new TrackingDeliveryError('TIKTOK_AUTH', false)
      if (code >= 50000) throw new TrackingDeliveryError('TIKTOK_UNAVAILABLE', true)
      throw new TrackingDeliveryError('TIKTOK_REJECTED', false)
    },
  }
}
