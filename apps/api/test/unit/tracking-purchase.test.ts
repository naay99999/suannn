import { describe, expect, it } from 'bun:test'
import { MAX_EVENT_AGE_MS, eligibleDestinations } from '../../src/modules/tracking/purchase'

const none = { gclid: null, gbraid: null, wbraid: null }

describe('eligibleDestinations', () => {
  it('only posthog without marketing consent', () => {
    expect(eligibleDestinations({ marketingConsent: false, ...none, gclid: 'abc' })).toEqual(['posthog'])
  })

  it('adds meta and tiktok with marketing consent', () => {
    expect(eligibleDestinations({ marketingConsent: true, ...none })).toEqual(['posthog', 'meta', 'tiktok'])
  })

  it('adds google_ads with marketing consent and any google click id', () => {
    expect(eligibleDestinations({ marketingConsent: true, ...none, gbraid: 'g' })).toContain('google_ads')
    expect(eligibleDestinations({ marketingConsent: true, ...none, wbraid: 'w' })).toContain('google_ads')
    expect(eligibleDestinations({ marketingConsent: true, ...none, gclid: 'c' })).toContain('google_ads')
  })

  it('defines the age limits', () => {
    expect(MAX_EVENT_AGE_MS.meta).toBe(7 * 24 * 60 * 60 * 1000)
    expect(MAX_EVENT_AGE_MS.google_ads).toBe(90 * 24 * 60 * 60 * 1000)
  })
})
