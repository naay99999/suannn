import type { TrackingConfig } from '../../../config/env'
import { GOOGLE_ADS_API_VERSION, GoogleAdsAuthError, googleAdsHeaders } from '../../google-ads/auth'
import { asRecord, requestJson } from './http'
import { countValue, microsToSatang } from './money'
import { SpendSyncError, type SpendRow, type SpendSource } from './types'

const MAX_PAGES = 200
const INVALID = 'GOOGLE_ADS_INVALID_AMOUNT'

export function createGoogleSpendSource(
  config: NonNullable<TrackingConfig['googleAds']>,
  tokens: () => Promise<string>,
  fetchImpl: typeof fetch = fetch,
): SpendSource {
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${encodeURIComponent(config.customerId)}/googleAds:search`

  async function accessToken(): Promise<string> {
    try {
      return await tokens()
    } catch (error) {
      throw new SpendSyncError(error instanceof GoogleAdsAuthError ? error.code : 'GOOGLE_ADS_UNAVAILABLE')
    }
  }

  async function search(token: string, body: Record<string, unknown>) {
    return asRecord(await requestJson('GOOGLE', fetchImpl, url, {
      method: 'POST',
      headers: { ...googleAdsHeaders(config, token), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  return {
    platform: 'google',
    async fetch(range) {
      const token = await accessToken()
      const query = 'SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, '
        + 'metrics.clicks, customer.currency_code FROM campaign '
        + `WHERE segments.date BETWEEN '${range.from}' AND '${range.to}'`
      const rows: SpendRow[] = []
      let pageToken: string | undefined
      for (let page = 0; page === 0 || pageToken; page += 1) {
        if (page >= MAX_PAGES) throw new SpendSyncError('GOOGLE_ADS_TOO_MANY_PAGES')
        const body = await search(token, { query, ...(pageToken ? { pageToken } : {}) })
        for (const item of Array.isArray(body.results) ? body.results : []) {
          const result = asRecord(item)
          const campaign = asRecord(result.campaign)
          const metrics = asRecord(result.metrics)
          const segments = asRecord(result.segments)
          if (campaign.id === undefined || typeof segments.date !== 'string') {
            throw new SpendSyncError('GOOGLE_ADS_INVALID_ROW')
          }
          const micros = metrics.costMicros === undefined || metrics.costMicros === null ? '0' : String(metrics.costMicros)
          const spendSatang = microsToSatang(micros)
          const impressions = countValue(metrics.impressions, INVALID)
          if (BigInt(micros) === 0n && impressions === 0) continue
          const currency = asRecord(result.customer).currencyCode
          rows.push({
            accountId: config.customerId,
            campaignId: String(campaign.id),
            campaignName: typeof campaign.name === 'string' ? campaign.name : '',
            date: segments.date,
            spendSatang,
            currency: typeof currency === 'string' ? currency : 'THB',
            impressions,
            clicks: countValue(metrics.clicks, INVALID),
          })
        }
        pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : undefined
      }
      let accountTimezone: string | null = null
      try {
        const body = await search(token, { query: 'SELECT customer.time_zone FROM customer LIMIT 1' })
        const first = asRecord(Array.isArray(body.results) ? body.results[0] : null)
        const zone = asRecord(first.customer).timeZone
        accountTimezone = typeof zone === 'string' ? zone : null
      } catch {
        accountTimezone = null
      }
      return { rows, accountTimezone }
    },
  }
}
