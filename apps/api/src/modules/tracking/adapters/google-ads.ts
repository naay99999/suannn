import {
  createGoogleAdsAccessTokens,
  GOOGLE_ADS_API_VERSION,
  GoogleAdsAuthError,
  googleAdsHeaders,
} from '../../google-ads/auth'
import { MAX_EVENT_AGE_MS } from '../purchase'
import { TrackingDeliveryError } from '../types'
import type { TrackingAdapter, TrackingConfigOf } from '../types'
import { deliveryErrorForStatus, postJson } from './http'

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000

// Asia/Bangkok has no DST, so a fixed +07:00 shift is exact.
function conversionDateTime(date: Date) {
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MS).toISOString()
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 19)}+07:00`
}

export function createGoogleAdsAdapter(
  config: TrackingConfigOf<'googleAds'>,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): TrackingAdapter {
  const uploadUrl = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${config.customerId}:uploadClickConversions`
  const getToken = createGoogleAdsAccessTokens(config, fetchImpl, now)

  async function accessToken(): Promise<string> {
    try {
      return await getToken()
    } catch (error) {
      if (!(error instanceof GoogleAdsAuthError)) throw error
      if (error.httpStatus !== undefined) throw deliveryErrorForStatus('GOOGLE_ADS', error.httpStatus)
      throw new TrackingDeliveryError(error.code, error.retryable)
    }
  }

  return {
    destination: 'google_ads',
    maxEventAgeMs: MAX_EVENT_AGE_MS.google_ads,
    async send(event) {
      const token = await accessToken()
      const { user } = event
      const userIdentifiers: Array<Record<string, string>> = []
      if (user.emailSha256) userIdentifiers.push({ hashedEmail: user.emailSha256 })
      if (user.phoneSha256) userIdentifiers.push({ hashedPhoneNumber: user.phoneSha256 })
      const clickId = user.gclid ? { gclid: user.gclid }
        : user.gbraid ? { gbraid: user.gbraid }
        : user.wbraid ? { wbraid: user.wbraid }
        : {}

      const response = await postJson(fetchImpl, 'GOOGLE_ADS', uploadUrl, {
        conversions: [{
          conversionAction: `customers/${config.customerId}/conversionActions/${config.conversionActionId}`,
          conversionDateTime: conversionDateTime(event.occurredAt),
          conversionValue: event.value,
          currencyCode: event.currency,
          orderId: event.eventId,
          // Rows are only enqueued when the order has marketing consent, so GRANTED is accurate.
          consent: { adUserData: 'GRANTED', adPersonalization: 'GRANTED' },
          ...clickId,
          ...(userIdentifiers.length > 0 ? { userIdentifiers } : {}),
        }],
        partialFailure: true,
      }, googleAdsHeaders(config, token))

      const result = await response.json().catch(() => null) as { partialFailureError?: unknown } | null
      if (result?.partialFailureError) throw new TrackingDeliveryError('GOOGLE_ADS_REJECTED', false)
    },
  }
}
