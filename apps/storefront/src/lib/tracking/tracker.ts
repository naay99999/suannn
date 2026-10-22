import type { BrowserEvent } from './events'
import { toPostHog } from './mappings'
import { capture } from './posthog'
import { sendToPixels } from './pixels'

let consent = { analytics: false, marketing: false }

export function setTrackingConsent(next: { analytics: boolean; marketing: boolean }): void {
  consent = { analytics: next.analytics, marketing: next.marketing }
}

// PostHog always receives events (anonymous without consent); ad pixels only with marketing consent.
export function track(e: BrowserEvent): void {
  try {
    const { name, properties } = toPostHog(e)
    capture(name, properties)
  } catch { /* ignore */ }
  if (!consent.marketing) return
  try {
    sendToPixels(e)
  } catch { /* ignore */ }
}
