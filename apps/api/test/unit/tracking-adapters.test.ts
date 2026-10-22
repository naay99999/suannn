import { describe, expect, test } from 'bun:test'
import { createMetaAdapter } from '../../src/modules/tracking/adapters/meta'
import { createPostHogAdapter } from '../../src/modules/tracking/adapters/posthog'
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
      api_key: 'phc_key', event: 'purchase', distinct_id: 'ph-1', timestamp: '2026-10-21T03:04:05.000Z',
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

  test('posts a Purchase to the Conversions API', async () => {
    const { calls, impl } = fakeFetch()
    const adapter = createMetaAdapter(config, impl)
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
      action_source: 'website',
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
    await createMetaAdapter({ ...config, testEventCode: 'TEST1' }, impl).send(event({ user: blankUser }))
    expect(calls[0]!.body.test_event_code).toBe('TEST1')
    expect(calls[0]!.body.data[0].user_data).toEqual({})
  })

  test('maps errors without leaking the token', async () => {
    const adapter = (r: any) => createMetaAdapter(config, fakeFetch([r]).impl)
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
