import { describe, expect, test } from 'bun:test'
import { createGoogleAdsAdapter } from '../../src/modules/tracking/adapters/google-ads'
import { createMetaAdapter } from '../../src/modules/tracking/adapters/meta'
import { createPostHogAdapter } from '../../src/modules/tracking/adapters/posthog'
import { createTikTokAdapter } from '../../src/modules/tracking/adapters/tiktok'
import { MAX_EVENT_AGE_MS } from '../../src/modules/tracking/purchase'
import { TrackingDeliveryError, type PurchaseEvent } from '../../src/modules/tracking/types'

interface Call { url: string, init: RequestInit, body: any }

function fakeFetch(responses: Array<{ status?: number, json?: unknown } | Error> = []) {
  const calls: Call[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : ''
    let body: any = raw
    try { body = JSON.parse(raw) } catch { /* form body */ }
    calls.push({ url: String(url), init: init ?? {}, body })
    const next = responses.length > 1 ? responses.shift()! : responses[0] ?? { status: 200, json: {} }
    if (next instanceof Error) throw next
    return new Response(JSON.stringify(next.json ?? {}), { status: next.status ?? 200 })
  }) as unknown as typeof fetch
  return { calls, impl }
}

function event(overrides: Partial<PurchaseEvent> = {}): PurchaseEvent {
  return {
    eventId: 'order-1',
    orderNumber: 'SU-1',
    occurredAt: new Date('2026-10-21T03:04:05Z'),
    value: 450,
    shipping: 50,
    currency: 'THB',
    contents: [{ variantId: 'v1', productId: 'p1', quantity: 2, unitPrice: 225 }],
    analyticsConsent: true,
    marketingConsent: true,
    posthogDistinctId: 'ph-1',
    user: {
      emailSha256: 'e'.repeat(64), phoneSha256: 'f'.repeat(64), clientIp: '203.0.113.9', userAgent: 'UA',
      fbp: 'fb.1.1.1', fbc: 'fb.1.1.2', ttclid: 'ttc', ttp: 'ttp1', gclid: 'g1', gbraid: 'gb1', wbraid: 'wb1',
    },
    ...overrides,
  }
}

const blankUser = { emailSha256: null, phoneSha256: null, clientIp: null, userAgent: null, fbp: null, fbc: null, ttclid: null, ttp: null, gclid: null, gbraid: null, wbraid: null }

async function failure(promise: Promise<unknown>) {
  try { await promise } catch (error) { return error as TrackingDeliveryError }
  throw new Error('expected rejection')
}

describe('PostHog adapter', () => {
  const config = { apiKey: 'phc_key', host: 'https://eu.i.posthog.com' }

  test('posts a purchase capture', async () => {
    const { calls, impl } = fakeFetch()
    const adapter = createPostHogAdapter(config, impl)
    expect(adapter.destination).toBe('posthog')
    expect(adapter.maxEventAgeMs).toBe(MAX_EVENT_AGE_MS.posthog)
    await adapter.send(event())
    expect(calls[0]!.url).toBe('https://eu.i.posthog.com/i/v0/e/')
    expect(calls[0]!.body).toMatchObject({
      api_key: 'phc_key', uuid: 'order-1', event: 'purchase', distinct_id: 'ph-1', timestamp: '2026-10-21T03:04:05.000Z',
      properties: { order_id: 'order-1', revenue: 450, currency: 'THB' },
    })
    expect(calls[0]!.body.properties.$process_person_profile).toBeUndefined()
  })

  test('falls back to order distinct id and disables person profiles without analytics consent', async () => {
    const { calls, impl } = fakeFetch()
    await createPostHogAdapter(config, impl).send(event({ posthogDistinctId: null, analyticsConsent: false }))
    expect(calls[0]!.body.distinct_id).toBe('order:order-1')
    expect(calls[0]!.body.properties.$process_person_profile).toBe(false)
  })

  test('tolerates a host with a trailing slash', async () => {
    const { calls, impl } = fakeFetch()
    await createPostHogAdapter({ ...config, host: 'https://eu.i.posthog.com/' }, impl).send(event())
    expect(calls[0]!.url).toBe('https://eu.i.posthog.com/i/v0/e/')
  })

  test('maps errors', async () => {
    const adapter = (r: any) => createPostHogAdapter(config, fakeFetch([r]).impl)
    expect(await failure(adapter({ status: 401 }).send(event()))).toMatchObject({ code: 'POSTHOG_AUTH', retryable: false })
    expect(await failure(adapter({ status: 400 }).send(event()))).toMatchObject({ code: 'POSTHOG_REJECTED', retryable: false })
    expect(await failure(adapter({ status: 429 }).send(event()))).toMatchObject({ code: 'POSTHOG_UNAVAILABLE', retryable: true })
    expect(await failure(adapter(new Error('boom')).send(event()))).toMatchObject({ code: 'POSTHOG_UNAVAILABLE', retryable: true })
  })
})

describe('Meta adapter', () => {
  const config = { pixelId: '12345', accessToken: 'secret-token', testEventCode: null }
  const options = { eventSourceUrl: 'https://shop.test' }

  test('posts a Purchase to the Conversions API', async () => {
    const { calls, impl } = fakeFetch()
    const adapter = createMetaAdapter(config, options, impl)
    expect(adapter.destination).toBe('meta')
    expect(adapter.maxEventAgeMs).toBe(MAX_EVENT_AGE_MS.meta)
    await adapter.send(event())
    const url = new URL(calls[0]!.url)
    expect(url.origin).toBe('https://graph.facebook.com')
    expect(url.pathname).toMatch(/^\/v\d+\.\d+\/12345\/events$/)
    expect(url.searchParams.get('access_token')).toBe('secret-token')
    const [data] = calls[0]!.body.data
    expect(data).toMatchObject({
      event_name: 'Purchase', event_id: 'order-1', event_time: Math.floor(Date.parse('2026-10-21T03:04:05Z') / 1000),
      action_source: 'website', event_source_url: 'https://shop.test',
      user_data: {
        em: ['e'.repeat(64)], ph: ['f'.repeat(64)], client_ip_address: '203.0.113.9', client_user_agent: 'UA',
        fbp: 'fb.1.1.1', fbc: 'fb.1.1.2',
      },
      custom_data: { currency: 'THB', value: 450, contents: [{ id: 'v1', quantity: 2, item_price: 225 }], content_type: 'product' },
    })
    expect(calls[0]!.body.test_event_code).toBeUndefined()
  })

  test('omits null user fields and includes the test event code when configured', async () => {
    const { calls, impl } = fakeFetch()
    await createMetaAdapter({ ...config, testEventCode: 'TEST1' }, options, impl).send(event({ user: blankUser }))
    expect(calls[0]!.body.test_event_code).toBe('TEST1')
    expect(calls[0]!.body.data[0].user_data).toEqual({})
  })

  test('maps errors without leaking the token', async () => {
    const adapter = (r: any) => createMetaAdapter(config, options, fakeFetch([r]).impl)
    const auth = await failure(adapter({ status: 401 }).send(event()))
    expect(auth).toBeInstanceOf(TrackingDeliveryError)
    expect(auth).toMatchObject({ code: 'META_AUTH', retryable: false })
    expect(await failure(adapter({ status: 403 }).send(event()))).toMatchObject({ code: 'META_AUTH' })
    expect(await failure(adapter({ status: 400 }).send(event()))).toMatchObject({ code: 'META_REJECTED', retryable: false })
    expect(await failure(adapter({ status: 500 }).send(event()))).toMatchObject({ code: 'META_UNAVAILABLE', retryable: true })
    const network = await failure(adapter(new Error('secret-token down')).send(event()))
    expect(network).toMatchObject({ code: 'META_UNAVAILABLE', retryable: true })
    expect(network.message).not.toContain('secret-token')
  })
})

describe('TikTok adapter', () => {
  const config = { pixelCode: 'PIX1', accessToken: 'tt-secret', testEventCode: null }

  test('posts a Purchase to the Events API', async () => {
    const { calls, impl } = fakeFetch([{ json: { code: 0 } }])
    const adapter = createTikTokAdapter(config, impl)
    expect(adapter.destination).toBe('tiktok')
    expect(adapter.maxEventAgeMs).toBe(MAX_EVENT_AGE_MS.tiktok)
    await adapter.send(event())
    expect(calls[0]!.url).toBe('https://business-api.tiktok.com/open_api/v1.3/event/track/')
    expect((calls[0]!.init.headers as Record<string, string>)['Access-Token']).toBe('tt-secret')
    expect(calls[0]!.body).toMatchObject({
      event_source: 'web',
      event_source_id: 'PIX1',
      data: [{
        event: 'Purchase', event_id: 'order-1', event_time: Math.floor(Date.parse('2026-10-21T03:04:05Z') / 1000),
        user: { email: 'e'.repeat(64), phone: 'f'.repeat(64), ip: '203.0.113.9', user_agent: 'UA', ttclid: 'ttc', ttp: 'ttp1' },
        properties: { currency: 'THB', value: 450, content_type: 'product', contents: [{ content_id: 'v1', quantity: 2, price: 225 }] },
      }],
    })
    expect(calls[0]!.body.test_event_code).toBeUndefined()
  })

  test('includes test event code and omits null user fields', async () => {
    const { calls, impl } = fakeFetch([{ json: { code: 0 } }])
    await createTikTokAdapter({ ...config, testEventCode: 'TEST9' }, impl).send(event({ user: blankUser }))
    expect(calls[0]!.body.test_event_code).toBe('TEST9')
    expect(calls[0]!.body.data[0].user).toEqual({})
  })

  test('maps errors', async () => {
    const adapter = (r: any) => createTikTokAdapter(config, fakeFetch([r]).impl)
    expect(await failure(adapter({ status: 401 }).send(event()))).toMatchObject({ code: 'TIKTOK_AUTH', retryable: false })
    expect(await failure(adapter({ status: 422 }).send(event()))).toMatchObject({ code: 'TIKTOK_REJECTED', retryable: false })
    expect(await failure(adapter({ status: 503 }).send(event()))).toMatchObject({ code: 'TIKTOK_UNAVAILABLE', retryable: true })
    expect(await failure(adapter(new Error('x')).send(event()))).toMatchObject({ code: 'TIKTOK_UNAVAILABLE', retryable: true })
  })

  test('maps a non-zero application code in a 200 response', async () => {
    const adapter = (code: number) => createTikTokAdapter(config, fakeFetch([{ json: { code } }]).impl)
    expect(await failure(adapter(40001).send(event()))).toMatchObject({ code: 'TIKTOK_AUTH', retryable: false })
    expect(await failure(adapter(40002).send(event()))).toMatchObject({ code: 'TIKTOK_REJECTED', retryable: false })
    expect(await failure(adapter(50002).send(event()))).toMatchObject({ code: 'TIKTOK_UNAVAILABLE', retryable: true })
    expect(await failure(adapter(40100).send(event()))).toMatchObject({ code: 'TIKTOK_UNAVAILABLE', retryable: true })
  })

  test('an unparseable 200 body is retryable, not success', async () => {
    const impl = (async () => new Response('<html>oops</html>', { status: 200 })) as unknown as typeof fetch
    expect(await failure(createTikTokAdapter(config, impl).send(event())))
      .toMatchObject({ code: 'TIKTOK_UNAVAILABLE', retryable: true })
  })
})

describe('Google Ads adapter', () => {
  const config = {
    developerToken: 'dev-tok', clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtok',
    customerId: '1234567890', conversionActionId: '555', loginCustomerId: '9998887776' as string | null,
  }
  const token = { json: { access_token: 'at-1', expires_in: 3600 } }

  test('exchanges a refresh token once and uploads a click conversion', async () => {
    const { calls, impl } = fakeFetch([token, { json: {} }])
    const adapter = createGoogleAdsAdapter(config, impl, () => new Date('2026-10-21T04:00:00Z'))
    expect(adapter.destination).toBe('google_ads')
    expect(adapter.maxEventAgeMs).toBe(MAX_EVENT_AGE_MS.google_ads)
    await adapter.send(event())
    await adapter.send(event())

    expect(calls).toHaveLength(3)
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token')
    const form = new URLSearchParams(calls[0]!.body)
    expect(form.get('grant_type')).toBe('refresh_token')
    expect(form.get('refresh_token')).toBe('rtok')
    expect(form.get('client_id')).toBe('cid')
    expect(form.get('client_secret')).toBe('csecret')

    const upload = calls[1]!
    expect(new URL(upload.url).origin + new URL(upload.url).pathname).toMatch(
      /^https:\/\/googleads\.googleapis\.com\/v25\/customers\/1234567890:uploadClickConversions$/,
    )
    const headers = upload.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer at-1')
    expect(headers['developer-token']).toBe('dev-tok')
    expect(headers['login-customer-id']).toBe('9998887776')
    expect(upload.body.partialFailure).toBe(true)
    expect(upload.body.conversions).toEqual([{
      conversionAction: 'customers/1234567890/conversionActions/555',
      conversionDateTime: '2026-10-21 10:04:05+07:00',
      conversionValue: 450,
      currencyCode: 'THB',
      orderId: 'order-1',
      consent: { adUserData: 'GRANTED', adPersonalization: 'GRANTED' },
      gclid: 'g1',
      userIdentifiers: [{ hashedEmail: 'e'.repeat(64) }, { hashedPhoneNumber: 'f'.repeat(64) }],
    }])
  })

  test('refreshes the token after it expires and omits login-customer-id when unset', async () => {
    let clock = new Date('2026-10-21T04:00:00Z')
    const { calls, impl } = fakeFetch([token, { json: {} }, { json: { access_token: 'at-2', expires_in: 3600 } }, { json: {} }])
    const adapter = createGoogleAdsAdapter({ ...config, loginCustomerId: null }, impl, () => clock)
    await adapter.send(event())
    clock = new Date('2026-10-21T04:59:30Z') // inside the 60 s safety margin
    await adapter.send(event())
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2)
    const headers = calls[1]!.init.headers as Record<string, string>
    expect(headers['login-customer-id']).toBeUndefined()
  })

  test('falls back to gbraid, then wbraid, and omits user identifiers that are null', async () => {
    const { calls, impl } = fakeFetch([token, { json: {} }])
    const adapter = createGoogleAdsAdapter(config, impl)
    await adapter.send(event({ user: { ...blankUser, gbraid: 'gb1', wbraid: 'wb1' } }))
    await adapter.send(event({ user: { ...blankUser, wbraid: 'wb1' } }))
    const [a, b] = [calls[1]!.body.conversions[0], calls[2]!.body.conversions[0]]
    expect(a.gbraid).toBe('gb1')
    expect(a.gclid).toBeUndefined()
    expect(a.wbraid).toBeUndefined()
    expect(a.userIdentifiers).toBeUndefined()
    expect(b.wbraid).toBe('wb1')
  })

  test('a partial failure in a 200 response is rejected', async () => {
    const { impl } = fakeFetch([token, { json: { partialFailureError: { code: 3, message: 'bad' } } }])
    expect(await failure(createGoogleAdsAdapter(config, impl).send(event())))
      .toMatchObject({ code: 'GOOGLE_ADS_REJECTED', retryable: false })
  })

  test('invalid_grant from the token endpoint is an auth failure', async () => {
    const { impl } = fakeFetch([{ status: 400, json: { error: 'invalid_grant' } }])
    expect(await failure(createGoogleAdsAdapter(config, impl).send(event())))
      .toMatchObject({ code: 'GOOGLE_ADS_AUTH', retryable: false })
  })

  test('maps token and upload transport errors', async () => {
    const tokenDown = fakeFetch([{ status: 503 }])
    expect(await failure(createGoogleAdsAdapter(config, tokenDown.impl).send(event())))
      .toMatchObject({ code: 'GOOGLE_ADS_UNAVAILABLE', retryable: true })
    const tokenNetwork = fakeFetch([new Error('x')])
    expect(await failure(createGoogleAdsAdapter(config, tokenNetwork.impl).send(event())))
      .toMatchObject({ code: 'GOOGLE_ADS_UNAVAILABLE', retryable: true })
    const unauthorized = fakeFetch([token, { status: 401 }])
    expect(await failure(createGoogleAdsAdapter(config, unauthorized.impl).send(event())))
      .toMatchObject({ code: 'GOOGLE_ADS_AUTH', retryable: false })
    const rejected = fakeFetch([token, { status: 400 }])
    expect(await failure(createGoogleAdsAdapter(config, rejected.impl).send(event())))
      .toMatchObject({ code: 'GOOGLE_ADS_REJECTED', retryable: false })
    const limited = fakeFetch([token, { status: 429 }])
    expect(await failure(createGoogleAdsAdapter(config, limited.impl).send(event())))
      .toMatchObject({ code: 'GOOGLE_ADS_UNAVAILABLE', retryable: true })
  })
})
