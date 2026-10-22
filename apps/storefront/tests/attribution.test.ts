import { beforeEach, expect, test } from 'bun:test'
import { mergeAttribution, readAttribution, recordLanding, touchFromUrl } from '../src/lib/tracking/attribution'

const now = new Date('2026-10-22T00:00:00.000Z')
const day = 24 * 60 * 60 * 1000

beforeEach(() => localStorage.clear())

test('captures utm params and click ids', () => {
  const url = new URL('https://shop.test/products?utm_source=meta&utm_campaign=launch&fbclid=abc')
  const touch = touchFromUrl(url, '', now)
  expect(touch).toMatchObject({
    utmSource: 'meta',
    utmCampaign: 'launch',
    fbclid: 'abc',
    landingPath: '/products?utm_source=meta&utm_campaign=launch&fbclid=abc',
    capturedAt: now.toISOString(),
  })
})

test('same-origin referrer without params is a direct visit', () => {
  expect(touchFromUrl(new URL('https://shop.test/a'), 'https://shop.test/b', now)).toBeNull()
  expect(touchFromUrl(new URL('https://shop.test/a'), 'not a url', now)).toBeNull()
})

test('external referrer counts as a touch', () => {
  const touch = touchFromUrl(new URL('https://shop.test/a'), 'https://www.google.com/', now)
  expect(touch?.referrer).toBe('https://www.google.com/')
})

test('direct visit leaves existing lastTouch unchanged', () => {
  const last = touchFromUrl(new URL('https://shop.test/?utm_source=x'), '', new Date(now.getTime() - day))!
  const merged = mergeAttribution({ firstTouch: last, lastTouch: last }, null, now)
  expect(merged.lastTouch).toEqual(last)
  expect(merged.firstTouch).toEqual(last)
})

test('new touch replaces lastTouch but firstTouch is set once', () => {
  const a = touchFromUrl(new URL('https://shop.test/?utm_source=a'), '', new Date(now.getTime() - day))!
  const b = touchFromUrl(new URL('https://shop.test/?utm_source=b'), '', now)!
  const merged = mergeAttribution({ firstTouch: a, lastTouch: a }, b, now)
  expect(merged.firstTouch).toEqual(a)
  expect(merged.lastTouch).toEqual(b)
})

test('touches older than 30 days are dropped', () => {
  const old = touchFromUrl(new URL('https://shop.test/?utm_source=a'), '', new Date(now.getTime() - 31 * day))!
  expect(mergeAttribution({ firstTouch: old, lastTouch: old }, null, now)).toEqual({})
})

test('values are truncated and control characters stripped', () => {
  const url = new URL(`https://shop.test/?utm_campaign=${'x'.repeat(10000)}&utm_source=a%00b`)
  const touch = touchFromUrl(url, '', now)!
  expect(touch.utmCampaign).toHaveLength(500)
  expect(touch.utmSource).toBe('ab')
  expect(touch.landingPath!.length).toBe(2000)
})

test('recordLanding persists and readAttribution returns it', () => {
  recordLanding(new URL('https://shop.test/p?gclid=g1') as unknown as Location, '')
  expect(readAttribution()?.lastTouch?.gclid).toBe('g1')
  recordLanding(new URL('https://shop.test/q') as unknown as Location, '')
  expect(readAttribution()?.lastTouch?.gclid).toBe('g1')
})

test('recordLanding never throws', () => {
  expect(() => recordLanding(null as unknown as Location, '')).not.toThrow()
})
