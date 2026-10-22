import { describe, expect, test } from 'bun:test'
import { GoogleAdsAuthError } from '../../src/modules/google-ads/auth'
import { createGoogleSpendSource } from '../../src/modules/marketing/spend/google'
import { createMetaSpendSource } from '../../src/modules/marketing/spend/meta'
import { decimalToSatang, microsToSatang } from '../../src/modules/marketing/spend/money'
import { createTikTokSpendSource } from '../../src/modules/marketing/spend/tiktok'
import { SpendSyncError } from '../../src/modules/marketing/spend/types'

interface Call { url: string, init?: RequestInit }

function fakeFetch(route: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return route(url, init)
  }) as unknown as typeof fetch
  return { calls, impl }
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(SpendSyncError)
    return (error as SpendSyncError).code
  }
  return 'NO_ERROR'
}

const range = { from: '2026-10-01', to: '2026-10-03' }

describe('money', () => {
  test('decimalToSatang is exact and half-up', () => {
    expect(decimalToSatang('1234.56', 'X')).toBe(123456)
    expect(decimalToSatang('0.1', 'X')).toBe(10)
    expect(decimalToSatang('0.005', 'X')).toBe(1)
    expect(decimalToSatang('0.004', 'X')).toBe(0)
    expect(decimalToSatang('0.0049999', 'X')).toBe(0)
    expect(decimalToSatang('12', 'X')).toBe(1200)
    expect(decimalToSatang('0.995', 'X')).toBe(100)
  })

  test('decimalToSatang rejects non-decimal input with the given code', () => {
    for (const bad of ['1e3', 'abc', '', '-1', '1.', '.5', '1,000']) {
      expect(() => decimalToSatang(bad, 'META_ADS_INVALID_AMOUNT')).toThrow('META_ADS_INVALID_AMOUNT')
    }
  })

  test('microsToSatang rounds to satang', () => {
    expect(microsToSatang('1234567890')).toBe(123457)
    expect(microsToSatang('0')).toBe(0)
    expect(microsToSatang('4999')).toBe(0)
    expect(microsToSatang('5000')).toBe(1)
    expect(() => microsToSatang('1.5')).toThrow(SpendSyncError)
  })
})

describe('meta spend source', () => {
  const config = { accountId: '123', accessToken: 'SECRET_TOKEN' }
  const page2 = 'https://graph.facebook.com/v23.0/act_123/insights?after=abc&access_token=SECRET_TOKEN'

  test('follows paging.next, sends the contract params and reads the timezone', async () => {
    const { calls, impl } = fakeFetch((url) => {
      if (url.includes('fields=timezone_name')) return json({ timezone_name: 'Asia/Bangkok', id: 'act_123' })
      if (url === page2) {
        return json({ data: [{ campaign_id: 'c2', campaign_name: 'Two', spend: '5', impressions: 10, clicks: '1', account_currency: 'THB', date_start: '2026-10-02' }] })
      }
      return json({
        data: [{ campaign_id: 'c1', campaign_name: 'One', spend: '12.345', impressions: '100', clicks: '7', account_currency: 'THB', date_start: '2026-10-01' }],
        paging: { next: page2 },
      })
    })
    const result = await createMetaSpendSource(config, impl).fetch(range)
    expect(result.accountTimezone).toBe('Asia/Bangkok')
    expect(result.rows).toEqual([
      { accountId: '123', campaignId: 'c1', campaignName: 'One', date: '2026-10-01', spendSatang: 1235, currency: 'THB', impressions: 100, clicks: 7 },
      { accountId: '123', campaignId: 'c2', campaignName: 'Two', date: '2026-10-02', spendSatang: 500, currency: 'THB', impressions: 10, clicks: 1 },
    ])
    const first = new URL(calls[0]!.url)
    expect(first.pathname).toBe('/v23.0/act_123/insights')
    expect(first.searchParams.get('level')).toBe('campaign')
    expect(first.searchParams.get('time_increment')).toBe('1')
    expect(first.searchParams.get('time_range')).toBe('{"since":"2026-10-01","until":"2026-10-03"}')
    expect(first.searchParams.get('limit')).toBe('500')
    expect(first.searchParams.get('access_token')).toBe('SECRET_TOKEN')
    expect(calls.length).toBe(3)
  })

  test('keeps non-THB currency and treats missing counts as 0', async () => {
    const { impl } = fakeFetch((url) => url.includes('timezone_name')
      ? json({}, 500)
      : json({ data: [{ campaign_id: 'c1', spend: '1.50', account_currency: 'USD', date_start: '2026-10-01' }] }))
    const result = await createMetaSpendSource(config, impl).fetch(range)
    expect(result.rows[0]).toMatchObject({ currency: 'USD', spendSatang: 150, impressions: 0, clicks: 0 })
    expect(result.accountTimezone).toBeNull()
  })

  test('maps HTTP failures to codes without leaking the token', async () => {
    const cases: Array<[number, string]> = [
      [401, 'META_ADS_AUTH'],
      [403, 'META_ADS_AUTH'],
      [429, 'META_ADS_UNAVAILABLE'],
      [503, 'META_ADS_UNAVAILABLE'],
      [400, 'META_ADS_REJECTED'],
    ]
    for (const [status, code] of cases) {
      const { impl } = fakeFetch(() => json({ error: 'SECRET_TOKEN' }, status))
      const error = await createMetaSpendSource(config, impl).fetch(range).catch((e: unknown) => e) as SpendSyncError
      expect(error.code).toBe(code)
      expect(error.message).toBe(code)
    }
  })

  test('network failure and bad amounts map to codes', async () => {
    const down = fakeFetch(() => { throw new Error('connect SECRET_TOKEN') })
    expect(await codeOf(createMetaSpendSource(config, down.impl).fetch(range))).toBe('META_ADS_UNAVAILABLE')
    const bad = fakeFetch(() => json({ data: [{ campaign_id: 'c', spend: 1e21, date_start: '2026-10-01' }] }))
    expect(await codeOf(createMetaSpendSource(config, bad.impl).fetch(range))).toBe('META_ADS_INVALID_AMOUNT')
  })
})

describe('tiktok spend source', () => {
  const config = { advertiserId: '777', accessToken: 'TT_SECRET' }
  const row = (id: string, day: string, spend: string | number, extra: Record<string, unknown> = {}) => ({
    dimensions: { campaign_id: id, stat_time_day: `${day} 00:00:00` },
    metrics: { spend, impressions: '10', clicks: 2, campaign_name: `n${id}`, currency: 'THB', ...extra },
  })

  test('loops pages, accepts string or number spend and reads the timezone', async () => {
    const { calls, impl } = fakeFetch((url) => {
      const u = new URL(url)
      if (u.pathname.endsWith('/advertiser/info/')) return json({ code: 0, data: { list: [{ timezone: 'Asia/Bangkok', currency: 'THB' }] } })
      const page = u.searchParams.get('page')
      return json({
        code: 0,
        data: {
          list: page === '1' ? [row('a', '2026-10-01', '10.5')] : [row('b', '2026-10-02', 3.25)],
          page_info: { page: Number(page), total_page: 2 },
        },
      })
    })
    const result = await createTikTokSpendSource(config, impl).fetch(range)
    expect(result.rows.map((r) => [r.campaignId, r.date, r.spendSatang, r.clicks])).toEqual([
      ['a', '2026-10-01', 1050, 2],
      ['b', '2026-10-02', 325, 2],
    ])
    expect(result.accountTimezone).toBe('Asia/Bangkok')
    const reports = calls.filter((c) => c.url.includes('/report/integrated/get/'))
    expect(reports.length).toBe(2)
    const u = new URL(reports[0]!.url)
    expect(u.searchParams.get('advertiser_id')).toBe('777')
    expect(u.searchParams.get('data_level')).toBe('AUCTION_CAMPAIGN')
    expect(u.searchParams.get('dimensions')).toBe('["campaign_id","stat_time_day"]')
    expect(u.searchParams.get('start_date')).toBe('2026-10-01')
    const headers = reports[0]!.init?.headers as Record<string, string>
    expect(headers['Access-Token']).toBe('TT_SECRET')
  })

  test('falls back to the advertiser currency once when the report omits it', async () => {
    const { calls, impl } = fakeFetch((url) => {
      if (url.includes('/advertiser/info/')) return json({ code: 0, data: { list: [{ timezone: 'Asia/Bangkok', currency: 'USD' }] } })
      return json({
        code: 0,
        data: {
          list: [row('a', '2026-10-01', '1', { currency: undefined }), row('b', '2026-10-01', '2', { currency: undefined })],
          page_info: { total_page: 1 },
        },
      })
    })
    const result = await createTikTokSpendSource(config, impl).fetch(range)
    expect(result.rows.map((r) => r.currency)).toEqual(['USD', 'USD'])
    expect(calls.filter((c) => c.url.includes('/advertiser/info/')).length).toBe(1)
  })

  test('timezone lookup failure yields null', async () => {
    const { impl } = fakeFetch((url) => url.includes('/advertiser/info/')
      ? json({ code: 50000, message: 'x' })
      : json({ code: 0, data: { list: [row('a', '2026-10-01', '1')], page_info: { total_page: 1 } } }))
    const result = await createTikTokSpendSource(config, impl).fetch(range)
    expect(result.accountTimezone).toBeNull()
    expect(result.rows.length).toBe(1)
  })

  test('body codes map to AUTH or REJECTED', async () => {
    for (const [code, expected] of [[40105, 'TIKTOK_ADS_AUTH'], [40001, 'TIKTOK_ADS_AUTH'], [40104, 'TIKTOK_ADS_AUTH'], [40002, 'TIKTOK_ADS_REJECTED']] as const) {
      const { impl } = fakeFetch(() => json({ code, message: 'TT_SECRET' }))
      const error = await createTikTokSpendSource(config, impl).fetch(range).catch((e: unknown) => e) as SpendSyncError
      expect(error.code).toBe(expected)
      expect(error.message).toBe(expected)
    }
  })

  test('HTTP statuses and bad amounts map to codes', async () => {
    const unauthorized = fakeFetch(() => json({}, 401))
    expect(await codeOf(createTikTokSpendSource(config, unauthorized.impl).fetch(range))).toBe('TIKTOK_ADS_AUTH')
    const limited = fakeFetch(() => json({}, 429))
    expect(await codeOf(createTikTokSpendSource(config, limited.impl).fetch(range))).toBe('TIKTOK_ADS_UNAVAILABLE')
    const bad = fakeFetch(() => json({ code: 0, data: { list: [row('a', '2026-10-01', 'NaN')], page_info: { total_page: 1 } } }))
    expect(await codeOf(createTikTokSpendSource(config, bad.impl).fetch(range))).toBe('TIKTOK_ADS_INVALID_AMOUNT')
  })
})

describe('google spend source', () => {
  const config = {
    developerToken: 'DEV',
    clientId: 'id',
    clientSecret: 'secret',
    refreshToken: 'refresh',
    customerId: '9988776655',
    conversionActionId: '1',
    loginCustomerId: null,
  }
  const tokens = async () => 'ACCESS'
  const result = (id: string, micros: string | undefined, impressions: string, date = '2026-10-01') => ({
    campaign: { id, name: `c${id}` },
    segments: { date },
    metrics: { costMicros: micros, impressions, clicks: '3' },
    customer: { currencyCode: 'THB' },
  })

  test('follows nextPageToken, converts micros, skips empty rows and reads the timezone', async () => {
    const { calls, impl } = fakeFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { query: string, pageToken?: string }
      if (body.query.includes('customer.time_zone')) return json({ results: [{ customer: { timeZone: 'Asia/Bangkok' } }] })
      if (body.pageToken === 'next') return json({ results: [result('2', '1234567890', '50', '2026-10-02')] })
      return json({ results: [result('1', '2500000', '100'), result('9', '0', '0'), result('8', undefined, '0')], nextPageToken: 'next' })
    })
    const out = await createGoogleSpendSource(config, tokens, impl).fetch(range)
    expect(out.rows).toEqual([
      { accountId: '9988776655', campaignId: '1', campaignName: 'c1', date: '2026-10-01', spendSatang: 250, currency: 'THB', impressions: 100, clicks: 3 },
      { accountId: '9988776655', campaignId: '2', campaignName: 'c2', date: '2026-10-02', spendSatang: 123457, currency: 'THB', impressions: 50, clicks: 3 },
    ])
    expect(out.accountTimezone).toBe('Asia/Bangkok')
    expect(calls[0]!.url).toBe('https://googleads.googleapis.com/v25/customers/9988776655/googleAds:search')
    expect(JSON.parse(String(calls[0]!.init?.body)).query).toContain(`segments.date BETWEEN '2026-10-01' AND '2026-10-03'`)
    const headers = calls[0]!.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer ACCESS')
    expect(headers['developer-token']).toBe('DEV')
    expect(JSON.parse(String(calls[1]!.init?.body)).pageToken).toBe('next')
  })

  test('timezone failure yields null without failing', async () => {
    const { impl } = fakeFetch((_url, init) => JSON.parse(String(init?.body)).query.includes('time_zone')
      ? json({}, 500)
      : json({ results: [result('1', '1000000', '5')] }))
    const out = await createGoogleSpendSource(config, tokens, impl).fetch(range)
    expect(out.accountTimezone).toBeNull()
    expect(out.rows.length).toBe(1)
  })

  test('HTTP failures map to codes', async () => {
    const cases: Array<[number, string]> = [[403, 'GOOGLE_ADS_AUTH'], [401, 'GOOGLE_ADS_AUTH'], [500, 'GOOGLE_ADS_UNAVAILABLE'], [400, 'GOOGLE_ADS_REJECTED']]
    for (const [status, code] of cases) {
      const { impl } = fakeFetch(() => json({ error: 'ACCESS' }, status))
      const error = await createGoogleSpendSource(config, tokens, impl).fetch(range).catch((e: unknown) => e) as SpendSyncError
      expect(error.code).toBe(code)
      expect(error.message).toBe(code)
    }
  })

  test('token errors map to SpendSyncError with the same code', async () => {
    const { impl } = fakeFetch(() => json({}))
    const authFail = async () => { throw new GoogleAdsAuthError('GOOGLE_ADS_AUTH', false) }
    expect(await codeOf(createGoogleSpendSource(config, authFail, impl).fetch(range))).toBe('GOOGLE_ADS_AUTH')
    const down = async () => { throw new GoogleAdsAuthError('GOOGLE_ADS_UNAVAILABLE', true) }
    expect(await codeOf(createGoogleSpendSource(config, down, impl).fetch(range))).toBe('GOOGLE_ADS_UNAVAILABLE')
  })
})
