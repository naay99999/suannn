import type { PlaceOrderBody } from '@/lib/store-checkout'
import { readAttribution } from './attribution'
import { readConsent } from './consent'
import { getDistinctId } from './posthog'

type CheckoutTracking = NonNullable<PlaceOrderBody['tracking']>

function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) {
      const value = rest.join('=')
      return value || undefined
    }
  }
  return undefined
}

// Context the server stores with the order so the purchase can be attributed and sent to ad destinations.
// Tracking must never break checkout: any failure yields no context.
export function buildCheckoutTracking(): CheckoutTracking | undefined {
  try {
    const consent = readConsent()
    const { firstTouch, lastTouch } = readAttribution()
    const tracking: Record<string, unknown> = {}
    if (consent?.consentId) tracking.consentId = consent.consentId
    if (consent?.analytics) {
      const distinctId = getDistinctId()
      if (distinctId) tracking.posthogDistinctId = distinctId
    }
    // capturedAt is already an ISO string; the API accepts it as such.
    if (firstTouch) tracking.firstTouch = firstTouch
    if (lastTouch) tracking.lastTouch = lastTouch
    if (consent?.marketing) {
      const fbp = readCookie('_fbp')
      const fbc = readCookie('_fbc') ?? (lastTouch?.fbclid ? `fb.1.${Date.now()}.${lastTouch.fbclid}` : undefined)
      const ttp = readCookie('_ttp')
      if (fbp) tracking.fbp = fbp
      if (fbc) tracking.fbc = fbc
      if (ttp) tracking.ttp = ttp
    }
    return Object.keys(tracking).length > 0 ? (tracking as CheckoutTracking) : undefined
  } catch {
    return undefined
  }
}
