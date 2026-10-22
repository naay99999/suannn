import { describe, expect, test } from 'bun:test'
import {
  createGoogleAdsAccessTokens,
  GoogleAdsAuthError,
  googleAdsHeaders,
} from '../../src/modules/google-ads/auth'

const config = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh' }

function fakeFetch(...responses: Array<{ status?: number, json?: unknown } | Error>) {
  let calls = 0
  const impl = (async () => {
    const next = responses[Math.min(calls, responses.length - 1)]!
    calls += 1
    if (next instanceof Error) throw next
    return new Response(JSON.stringify(next.json ?? {}), { status: next.status ?? 200 })
  }) as unknown as typeof fetch
  return { impl, count: () => calls }
}

const ok = { json: { access_token: 'tok', expires_in: 3600 } }

async function failure(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected rejection')
}

describe('google ads access tokens', () => {
  test('a token fetch that never resolves rejects as retryable UNAVAILABLE', async () => {
    const hung = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch
    const token = createGoogleAdsAccessTokens(config, hung, () => new Date(), 20)
    const error = await failure(token())
    expect(error).toBeInstanceOf(GoogleAdsAuthError)
    expect(error).toMatchObject({ code: 'GOOGLE_ADS_UNAVAILABLE', retryable: true })
  })

  test('two calls make one token request', async () => {
    const { impl, count } = fakeFetch(ok)
    const token = createGoogleAdsAccessTokens(config, impl)
    expect(await token()).toBe('tok')
    expect(await token()).toBe('tok')
    expect(count()).toBe(1)
  })

  test('refreshes 60 seconds before expiry', async () => {
    let clock = new Date('2026-10-22T00:00:00Z')
    const { impl, count } = fakeFetch(ok)
    const token = createGoogleAdsAccessTokens(config, impl, () => clock)
    await token()
    clock = new Date(clock.getTime() + (3600 - 61) * 1000)
    await token()
    expect(count()).toBe(1)
    clock = new Date(clock.getTime() + 2 * 1000)
    await token()
    expect(count()).toBe(2)
  })

  test('invalid_grant is a non-retryable auth failure', async () => {
    const { impl } = fakeFetch({ status: 400, json: { error: 'invalid_grant' } })
    expect(await failure(createGoogleAdsAccessTokens(config, impl)()))
      .toMatchObject({ code: 'GOOGLE_ADS_AUTH', retryable: false })
  })

  test('a network error is retryable unavailable', async () => {
    const { impl } = fakeFetch(new Error('down'))
    const error = await failure(createGoogleAdsAccessTokens(config, impl)())
    expect(error).toBeInstanceOf(GoogleAdsAuthError)
    expect(error).toMatchObject({ code: 'GOOGLE_ADS_UNAVAILABLE', retryable: true })
  })

  test('5xx is retryable unavailable and 403 is auth', async () => {
    expect(await failure(createGoogleAdsAccessTokens(config, fakeFetch({ status: 503 }).impl)()))
      .toMatchObject({ code: 'GOOGLE_ADS_UNAVAILABLE', retryable: true })
    expect(await failure(createGoogleAdsAccessTokens(config, fakeFetch({ status: 403 }).impl)()))
      .toMatchObject({ code: 'GOOGLE_ADS_AUTH', retryable: false })
  })

  test('builds request headers', () => {
    expect(googleAdsHeaders({ developerToken: 'dev', loginCustomerId: null }, 't'))
      .toEqual({ authorization: 'Bearer t', 'developer-token': 'dev' })
    expect(googleAdsHeaders({ developerToken: 'dev', loginCustomerId: '99' }, 't'))
      .toEqual({ authorization: 'Bearer t', 'developer-token': 'dev', 'login-customer-id': '99' })
  })
})
