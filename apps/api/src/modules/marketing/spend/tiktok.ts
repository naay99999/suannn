import type { MarketingConfig } from '../../../config/env'
import { asRecord, requestJson } from './http'
import { amountString, countValue, decimalToSatang } from './money'
import { SpendSyncError, type SpendRow, type SpendSource } from './types'

export const TIKTOK_API_VERSION = 'v1.3'
const BASE = `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}`
const PAGE_SIZE = 1000
const MAX_PAGES = 200
const INVALID = 'TIKTOK_ADS_INVALID_AMOUNT'
const AUTH_CODES = new Set([40001, 40104, 40105])
// Day-level reports accept at most 30 days per request.
const MAX_WINDOW_DAYS = 30
const DAY_MS = 86_400_000

interface AdvertiserInfo { timezone: string | null, currency: string | null }

function dayWindows(from: string, to: string): Array<{ from: string, to: string }> {
  const windows: Array<{ from: string, to: string }> = []
  const end = Date.parse(`${to}T00:00:00Z`)
  for (let start = Date.parse(`${from}T00:00:00Z`); start <= end; start += MAX_WINDOW_DAYS * DAY_MS) {
    const last = Math.min(start + (MAX_WINDOW_DAYS - 1) * DAY_MS, end)
    windows.push({ from: new Date(start).toISOString().slice(0, 10), to: new Date(last).toISOString().slice(0, 10) })
  }
  return windows
}

export function createTikTokSpendSource(
  config: NonNullable<MarketingConfig['tiktokAds']>,
  fetchImpl: typeof fetch = fetch,
): SpendSource {
  const headers = { 'Access-Token': config.accessToken }

  async function call(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = `${BASE}${path}?${new URLSearchParams(params)}`
    const body = asRecord(await requestJson('TIKTOK', fetchImpl, url, { headers }))
    const code = body.code
    if (code !== undefined && code !== 0) {
      throw new SpendSyncError(typeof code === 'number' && AUTH_CODES.has(code) ? 'TIKTOK_ADS_AUTH' : 'TIKTOK_ADS_REJECTED')
    }
    return asRecord(body.data)
  }

  async function loadInfo(): Promise<AdvertiserInfo> {
    const data = await call('/advertiser/info/', {
      advertiser_ids: JSON.stringify([config.advertiserId]),
      fields: JSON.stringify(['timezone', 'currency']),
    })
    const first = asRecord(Array.isArray(data.list) ? data.list[0] : null)
    return {
      timezone: typeof first.timezone === 'string' ? first.timezone : null,
      currency: typeof first.currency === 'string' ? first.currency : null,
    }
  }

  async function fetchWindow(
    window: { from: string, to: string },
    advertiserInfo: () => Promise<AdvertiserInfo>,
  ): Promise<SpendRow[]> {
    const rows: SpendRow[] = []
    let totalPages = 1
    for (let page = 1; page <= totalPages; page += 1) {
      if (page > MAX_PAGES) throw new SpendSyncError('TIKTOK_ADS_TOO_MANY_PAGES')
      const data = await call('/report/integrated/get/', {
        advertiser_id: config.advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'campaign_name', 'currency']),
        start_date: window.from,
        end_date: window.to,
        page: String(page),
        page_size: String(PAGE_SIZE),
      })
      const total = asRecord(data.page_info).total_page
      if (typeof total === 'number' && Number.isInteger(total) && total > 0) totalPages = total
      for (const item of Array.isArray(data.list) ? data.list : []) {
        const entry = asRecord(item)
        const dimensions = asRecord(entry.dimensions)
        const metrics = asRecord(entry.metrics)
        if (typeof dimensions.campaign_id !== 'string' || typeof dimensions.stat_time_day !== 'string') {
          throw new SpendSyncError('TIKTOK_ADS_INVALID_ROW')
        }
        let currency = typeof metrics.currency === 'string' && metrics.currency ? metrics.currency : null
        if (!currency) {
          try {
            currency = (await advertiserInfo()).currency
          } catch (error) {
            throw error instanceof SpendSyncError ? error : new SpendSyncError('TIKTOK_ADS_UNAVAILABLE')
          }
        }
        if (!currency) throw new SpendSyncError('TIKTOK_ADS_INVALID_ROW')
        rows.push({
          accountId: config.advertiserId,
          campaignId: dimensions.campaign_id,
          campaignName: typeof metrics.campaign_name === 'string' ? metrics.campaign_name : '',
          date: dimensions.stat_time_day.slice(0, 10),
          spendSatang: decimalToSatang(amountString(metrics.spend ?? '0', INVALID), INVALID),
          currency,
          impressions: countValue(metrics.impressions, INVALID),
          clicks: countValue(metrics.clicks, INVALID),
        })
      }
    }
    return rows
  }

  return {
    platform: 'tiktok',
    async fetch(range) {
      // One advertiser lookup per run, shared by the currency fallback and the timezone.
      let info: Promise<AdvertiserInfo> | null = null
      const advertiserInfo = () => (info ??= loadInfo())
      const rows: SpendRow[] = []
      for (const window of dayWindows(range.from, range.to)) {
        rows.push(...await fetchWindow(window, advertiserInfo))
      }
      let accountTimezone: string | null = null
      try {
        accountTimezone = (await advertiserInfo()).timezone
      } catch {
        accountTimezone = null
      }
      return { rows, accountTimezone }
    },
  }
}
