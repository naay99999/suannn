import type { PlaceOrderBody } from '@/lib/store-checkout'
import { safeGet, safeSet } from './storage'

type ApiTouch = NonNullable<NonNullable<PlaceOrderBody['tracking']>['lastTouch']>

// Eden may revive ISO strings as Date; the stored value is always a string.
export type TrackingTouch = Omit<ApiTouch, 'capturedAt'> & { capturedAt: string }
export type Attribution = { firstTouch?: TrackingTouch; lastTouch?: TrackingTouch }

const STORAGE_KEY = 'suannn.attribution'
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const MAX_VALUE = 500
const MAX_LONG_VALUE = 2000

const PARAM_FIELDS = [
  ['utm_source', 'utmSource'],
  ['utm_medium', 'utmMedium'],
  ['utm_campaign', 'utmCampaign'],
  ['utm_content', 'utmContent'],
  ['utm_term', 'utmTerm'],
  ['fbclid', 'fbclid'],
  ['ttclid', 'ttclid'],
  ['gclid', 'gclid'],
  ['gbraid', 'gbraid'],
  ['wbraid', 'wbraid'],
] as const

function clean(value: string, max = MAX_VALUE): string | undefined {
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  const result = stripped.slice(0, max)
  return result.length > 0 ? result : undefined
}

export function touchFromUrl(url: URL, referrer: string, now: Date): TrackingTouch | null {
  const fields: Partial<Record<(typeof PARAM_FIELDS)[number][1], string>> = {}
  let hasCampaign = false
  for (const [param, field] of PARAM_FIELDS) {
    const value = clean(url.searchParams.get(param) ?? '')
    if (value) {
      fields[field] = value
      hasCampaign = true
    }
  }

  let externalReferrer: string | undefined
  if (referrer) {
    try {
      if (new URL(referrer).origin !== url.origin) externalReferrer = clean(referrer, MAX_LONG_VALUE)
    } catch {
      // An unparseable referrer counts as no referrer.
    }
  }

  if (!hasCampaign && !externalReferrer) return null

  const landingPath = clean(url.pathname + url.search, MAX_LONG_VALUE)
  return {
    ...fields,
    ...(externalReferrer ? { referrer: externalReferrer } : {}),
    ...(landingPath?.startsWith('/') ? { landingPath } : {}),
    capturedAt: now.toISOString(),
  }
}

function fresh(touch: TrackingTouch | undefined, now: Date): TrackingTouch | undefined {
  if (!touch) return undefined
  const age = now.getTime() - new Date(touch.capturedAt).getTime()
  return Number.isFinite(age) && age <= WINDOW_MS ? touch : undefined
}

function hasCampaignSignal(touch: TrackingTouch): boolean {
  return PARAM_FIELDS.some(([, field]) => Boolean(touch[field]))
}

export function mergeAttribution(stored: Attribution | null, touch: TrackingTouch | null, now: Date): Attribution {
  const firstTouch = fresh(stored?.firstTouch, now) ?? touch ?? undefined
  const storedLast = fresh(stored?.lastTouch, now)
  // A referrer-only touch (e.g. returning from Stripe or an auth provider) must not displace a fresh campaign touch.
  const lastTouch = touch && (hasCampaignSignal(touch) || !storedLast) ? touch : storedLast
  return {
    ...(firstTouch ? { firstTouch } : {}),
    ...(lastTouch ? { lastTouch } : {}),
  }
}

function load(): Attribution | null {
  try {
    const raw = safeGet(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Attribution) : null
  } catch {
    return null
  }
}

export function recordLanding(location: Location, referrer: string): void {
  try {
    const now = new Date()
    const touch = touchFromUrl(new URL(location.href), referrer, now)
    safeSet(STORAGE_KEY, JSON.stringify(mergeAttribution(load(), touch, now)))
  } catch {
    // Attribution must never break the page.
  }
}

export function readAttribution(now: Date = new Date()): Attribution {
  return mergeAttribution(load(), null, now)
}
