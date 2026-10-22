import type { MarketingConfig } from '../../../config/env'
import { META_GRAPH_API_VERSION } from '../../tracking/adapters/meta'
import { asRecord, requestJson } from './http'
import { amountString, countValue, decimalToSatang } from './money'
import { SpendSyncError, type SpendRow, type SpendSource } from './types'

const PAGE_LIMIT = 500
const MAX_PAGES = 200
const INVALID = 'META_ADS_INVALID_AMOUNT'

export function createMetaSpendSource(
  config: NonNullable<MarketingConfig['metaAds']>,
  fetchImpl: typeof fetch = fetch,
): SpendSource {
  // access_token travels as a query parameter; URLs are never logged or put in errors.
  const base = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/act_${encodeURIComponent(config.accountId)}`

  async function timezone(): Promise<string | null> {
    try {
      const url = `${base}?${new URLSearchParams({ fields: 'timezone_name', access_token: config.accessToken })}`
      const body = asRecord(await requestJson('META', fetchImpl, url))
      return typeof body.timezone_name === 'string' ? body.timezone_name : null
    } catch {
      return null
    }
  }

  return {
    platform: 'meta',
    async fetch(range) {
      const params = new URLSearchParams({
        level: 'campaign',
        time_increment: '1',
        time_range: JSON.stringify({ since: range.from, until: range.to }),
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,account_currency',
        limit: String(PAGE_LIMIT),
        access_token: config.accessToken,
      })
      let url: string | null = `${base}/insights?${params}`
      const rows: SpendRow[] = []
      for (let page = 0; url; page += 1) {
        if (page >= MAX_PAGES) throw new SpendSyncError('META_ADS_TOO_MANY_PAGES')
        const body = asRecord(await requestJson('META', fetchImpl, url))
        for (const item of Array.isArray(body.data) ? body.data : []) {
          const row = asRecord(item)
          if (typeof row.campaign_id !== 'string' || typeof row.date_start !== 'string') {
            throw new SpendSyncError('META_ADS_INVALID_ROW')
          }
          rows.push({
            accountId: config.accountId,
            campaignId: row.campaign_id,
            campaignName: typeof row.campaign_name === 'string' ? row.campaign_name : '',
            date: row.date_start,
            spendSatang: decimalToSatang(amountString(row.spend ?? '0', INVALID), INVALID),
            currency: typeof row.account_currency === 'string' ? row.account_currency : 'THB',
            impressions: countValue(row.impressions, INVALID),
            clicks: countValue(row.clicks, INVALID),
          })
        }
        const next = asRecord(body.paging).next
        url = typeof next === 'string' && next ? next : null
      }
      return { rows, accountTimezone: await timezone() }
    },
  }
}
