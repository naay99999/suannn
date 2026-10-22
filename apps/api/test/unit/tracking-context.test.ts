import { describe, expect, it } from 'bun:test'
import { sanitizeTrackingContext } from '../../src/modules/tracking/context'

const consentId = '22222222-2222-4222-8222-222222222222'
const capturedAt = new Date().toISOString()

describe('sanitizeTrackingContext', () => {
  it('truncates long strings to 500 characters', () => {
    const result = sanitizeTrackingContext({ lastTouch: { utmCampaign: 'x'.repeat(10_000), capturedAt } })
    expect(result?.lastTouch?.utmCampaign).toHaveLength(500)
  })

  it('allows 2000 characters for referrer and landingPath', () => {
    const result = sanitizeTrackingContext({
      lastTouch: { referrer: 'r'.repeat(5000), landingPath: `/${'p'.repeat(5000)}`, capturedAt },
    })
    expect(result?.lastTouch?.referrer).toHaveLength(2000)
    expect(result?.lastTouch?.landingPath).toHaveLength(2000)
  })

  it('removes a landingPath that does not start with a slash', () => {
    const result = sanitizeTrackingContext({ lastTouch: { landingPath: 'javascript:x', utmSource: 'a', capturedAt } })
    expect(result?.lastTouch?.landingPath).toBeUndefined()
    expect(result?.lastTouch?.utmSource).toBe('a')
  })

  it('removes an invalid consentId', () => {
    const result = sanitizeTrackingContext({ consentId: 'nope', posthogDistinctId: 'ph-1' })
    expect(result).toEqual({ posthogDistinctId: 'ph-1' })
  })

  it('returns undefined when nothing valid remains', () => {
    expect(sanitizeTrackingContext({ evil: 1 })).toBeUndefined()
    expect(sanitizeTrackingContext(null)).toBeUndefined()
    expect(sanitizeTrackingContext('x')).toBeUndefined()
    expect(sanitizeTrackingContext([])).toBeUndefined()
    expect(sanitizeTrackingContext({ fbp: 12, lastTouch: { capturedAt } })).toBeUndefined()
  })

  it('strips control characters and trims', () => {
    const result = sanitizeTrackingContext({ fbp: '  fb.1\u0000.\u0007abc\n ' })
    expect(result?.fbp).toBe('fb.1.abc')
  })

  it('drops touches with an invalid or far-future capturedAt', () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString()
    expect(sanitizeTrackingContext({ lastTouch: { utmSource: 'a', capturedAt: future } })).toBeUndefined()
    expect(sanitizeTrackingContext({ lastTouch: { utmSource: 'a', capturedAt: 'garbage' } })).toBeUndefined()
    expect(sanitizeTrackingContext({ lastTouch: { utmSource: 'a' } })).toBeUndefined()
  })

  it('drops a touch with no fields left', () => {
    expect(sanitizeTrackingContext({ consentId, firstTouch: { evil: 'x', capturedAt } })).toEqual({ consentId })
  })

  it('round-trips a valid full context', () => {
    const touch = {
      utmSource: 'facebook', utmMedium: 'cpc', utmCampaign: 'spring', utmContent: 'a', utmTerm: 'durian',
      fbclid: 'f', ttclid: 't', gclid: 'g', gbraid: 'gb', wbraid: 'wb',
      referrer: 'https://example.com/', landingPath: '/products/durian', capturedAt,
    }
    const context = {
      consentId, posthogDistinctId: 'ph-1',
      firstTouch: touch, lastTouch: { ...touch, utmSource: 'google' },
      fbp: 'fb.1.1', fbc: 'fb.1.2', ttp: 'tt',
    }
    expect(sanitizeTrackingContext(structuredClone(context))).toEqual(context)
  })
})
