import { MAX_EVENT_AGE_MS } from '../purchase'
import { TrackingDeliveryError } from '../types'
import type { TrackingAdapter, TrackingConfigOf } from '../types'
import { deliveryErrorForStatus, postJson } from './http'

const GOOGLE_ADS_API_VERSION = 'v21'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TOKEN_SAFETY_MARGIN_MS = 60_000
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
  let cached: { token: string, expiresAt: number } | null = null

  async function accessToken(): Promise<string> {
    if (cached && now().getTime() < cached.expiresAt) return cached.token
    let response: Response
    try {
      response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: config.refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }).toString(),
      })
    } catch {
      throw new TrackingDeliveryError('GOOGLE_ADS_UNAVAILABLE', true)
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: unknown } | null
      // A revoked or expired refresh token needs operator action, not retries.
      if (body?.error === 'invalid_grant' || body?.error === 'invalid_client') {
        throw new TrackingDeliveryError('GOOGLE_ADS_AUTH', false)
      }
      throw deliveryErrorForStatus('GOOGLE_ADS', response.status)
    }
    const body = await response.json().catch(() => null) as { access_token?: unknown, expires_in?: unknown } | null
    if (typeof body?.access_token !== 'string' || typeof body.expires_in !== 'number') {
      throw new TrackingDeliveryError('GOOGLE_ADS_UNAVAILABLE', true)
    }
    cached = { token: body.access_token, expiresAt: now().getTime() + body.expires_in * 1000 - TOKEN_SAFETY_MARGIN_MS }
    return body.access_token
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
          ...clickId,
          ...(userIdentifiers.length > 0 ? { userIdentifiers } : {}),
        }],
        partialFailure: true,
      }, {
        authorization: `Bearer ${token}`,
        'developer-token': config.developerToken,
        ...(config.loginCustomerId ? { 'login-customer-id': config.loginCustomerId } : {}),
      })

      const result = await response.json().catch(() => null) as { partialFailureError?: unknown } | null
      if (result?.partialFailureError) throw new TrackingDeliveryError('GOOGLE_ADS_REJECTED', false)
    },
  }
}
