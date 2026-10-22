import { beforeEach, describe, expect, mock, test } from 'bun:test'

const captured: Array<[string, Record<string, unknown>]> = []
let captureThrows = false
const calls: string[] = []
const registered: Array<Record<string, unknown>> = []

mock.module('posthog-js', () => ({
  default: {
    init: () => {},
    register: (properties: Record<string, unknown>) => { registered.push(properties) },
    capture: (name: string, properties: Record<string, unknown>) => {
      if (captureThrows) throw new Error('boom')
      captured.push([name, properties])
    },
    set_config: (config: Record<string, unknown>) => { calls.push(`set_config:${JSON.stringify(config)}`) },
    startSessionRecording: () => {},
    stopSessionRecording: () => {},
    reset: () => { calls.push('reset') },
    identify: () => {},
    get_distinct_id: () => 'distinct',
    getFeatureFlag: () => undefined,
    onFeatureFlags: () => () => {},
  },
}))

const { toGoogle, toMeta, toPostHog, toTikTok } = await import('../src/lib/tracking/mappings')
const { loadPixels } = await import('../src/lib/tracking/pixels')
const { initPostHog, registerAttribution, setAnalyticsConsent } = await import('../src/lib/tracking/posthog')
const { setTrackingConsent, track } = await import('../src/lib/tracking/tracker')
const { recordLanding } = await import('../src/lib/tracking/attribution')
type BrowserEvent = import('../src/lib/tracking/events').BrowserEvent

const item = { productId: 'p1', variantId: 'v1', name: 'ทุเรียน', price: 250, quantity: 2 }
const events: BrowserEvent[] = [
  { name: 'page_view', path: '/products?x=1' },
  { name: 'view_item', item },
  { name: 'add_to_cart', item },
  { name: 'begin_checkout', items: [item], value: 500 },
]

describe('mappings', () => {
  test('event names per sink', () => {
    expect(events.map(e => toMeta(e).name)).toEqual(['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout'])
    expect(events.map(e => toTikTok(e).name)).toEqual(['Pageview', 'ViewContent', 'AddToCart', 'InitiateCheckout'])
    expect(events.map(e => toGoogle(e).name)).toEqual(['page_view', 'view_item', 'add_to_cart', 'begin_checkout'])
    expect(events.map(e => toPostHog(e).name)).toEqual(['$pageview', 'view_item', 'add_to_cart', 'begin_checkout'])
  })

  test('values are THB and content ids are variant ids', () => {
    const meta = toMeta(events[2]!).params
    expect(meta.currency).toBe('THB')
    expect(meta.content_ids).toEqual(['v1'])
    expect(meta.value).toBe(500)
    const tiktok = toTikTok(events[3]!).params
    expect(tiktok.currency).toBe('THB')
    expect(tiktok.value).toBe(500)
    expect((tiktok.contents as Array<{ content_id: string }>)[0]!.content_id).toBe('v1')
    const google = toGoogle(events[1]!).params
    expect(google.currency).toBe('THB')
    expect(google.value).toBe(250)
    expect((google.items as Array<{ item_id: string }>)[0]!.item_id).toBe('v1')
    const posthog = toPostHog(events[3]!).properties
    expect(posthog.currency).toBe('THB')
    expect(posthog.value).toBe(500)
  })
})

describe('campaign attribution super-properties', () => {
  test('init registers the stored last touch', async () => {
    recordLanding({ href: 'https://shop.test/?utm_source=meta&utm_campaign=123' } as Location, '')
    registered.length = 0
    // A fresh module instance, since other files may already have initialised the shared one.
    const fresh = await import('../src/lib/tracking/posthog?fresh-init')
    fresh.initPostHog('phc_test', 'https://example.test')
    expect(registered).toEqual([{ utm_source: 'meta', utm_campaign: '123' }])
  })

  test('registers only present values and nothing for no touch', () => {
    registered.length = 0
    registerAttribution(undefined)
    registerAttribution({ capturedAt: '2026-10-22T00:00:00Z' })
    expect(registered).toEqual([])
    registerAttribution({ utmSource: 'tiktok', utmMedium: 'paid', utmContent: 'ad1', capturedAt: '2026-10-22T00:00:00Z' })
    expect(registered).toEqual([{ utm_source: 'tiktok', utm_medium: 'paid', utm_content: 'ad1' }])
  })

  test('re-registers after the persistence mode changes', () => {
    registered.length = 0
    setAnalyticsConsent(true)
    setAnalyticsConsent(false)
    expect(registered).toEqual([
      { utm_source: 'meta', utm_campaign: '123' },
      { utm_source: 'meta', utm_campaign: '123' },
    ])
  })
})

describe('track', () => {
  beforeEach(() => {
    captured.length = 0
    captureThrows = false
    setTrackingConsent({ analytics: false, marketing: false })
    initPostHog('phc_test', 'https://example.test')
  })

  test('without marketing consent PostHog is captured and pixels are not called', () => {
    loadPixels({ metaPixelId: '111' })
    const fbq = window.fbq as unknown as { queue: unknown[][] }
    const before = fbq.queue.length
    track(events[1]!)
    expect(captured.map(([name]) => name)).toEqual(['view_item'])
    expect(fbq.queue.length).toBe(before)
  })

  test('with marketing consent loaded pixels receive the event', () => {
    loadPixels({ metaPixelId: '111' })
    const fbq = window.fbq as unknown as { queue: unknown[][] }
    const before = fbq.queue.length
    setTrackingConsent({ analytics: true, marketing: true })
    track(events[1]!)
    expect(fbq.queue.length).toBe(before + 1)
    expect(Array.from(fbq.queue.at(-1)!).slice(0, 2)).toEqual(['track', 'ViewContent'])
  })

  test('stops calling pixels after marketing consent is revoked', () => {
    loadPixels({ metaPixelId: '111' })
    const fbq = window.fbq as unknown as { queue: unknown[][] }
    setTrackingConsent({ analytics: true, marketing: true })
    track(events[1]!)
    const sent = fbq.queue.length
    setTrackingConsent({ analytics: true, marketing: false })
    track(events[1]!)
    expect(fbq.queue.length).toBe(sent)
  })

  test('revoking analytics resets PostHog and returns to memory persistence', () => {
    calls.length = 0
    setAnalyticsConsent(false)
    expect(calls).toContain('reset')
    expect(calls.some(call => call.startsWith('set_config:') && call.includes('"persistence":"memory"'))).toBe(true)
  })

  test('never throws when a sink throws', () => {
    captureThrows = true
    expect(() => track(events[0]!)).not.toThrow()
  })
})

describe('loadPixels', () => {
  test('is idempotent: one script per pixel', () => {
    const ids = { metaPixelId: '111', tiktokPixelCode: 'TT1', googleAdsId: 'AW-1' }
    loadPixels(ids)
    loadPixels(ids)
    for (const pixel of ['meta', 'tiktok', 'google']) {
      expect(document.head.querySelectorAll(`script[data-tracking-pixel="${pixel}"]`).length).toBe(1)
    }
    expect(document.head.querySelector('script[data-tracking-pixel="google"]')?.getAttribute('src')).toBe('https://www.googletagmanager.com/gtag/js?id=AW-1')
  })
})
