import type { TrackingConfig } from '../../config/env'

export type TrackingConfigOf<K extends 'posthog' | 'meta' | 'tiktok' | 'googleAds'> = NonNullable<TrackingConfig[K]>

export type TrackingDestination = 'posthog' | 'meta' | 'tiktok' | 'google_ads'

export const trackingDestinations: readonly TrackingDestination[] = ['posthog', 'meta', 'tiktok', 'google_ads']

export const trackingDestinationLabels: Record<TrackingDestination, string> = {
  posthog: 'PostHog',
  meta: 'Meta',
  tiktok: 'TikTok',
  google_ads: 'Google Ads',
}

// Config key per destination (google_ads is googleAds in TrackingConfig).
export const trackingConfigKeys: Record<TrackingDestination, keyof TrackingConfig> = {
  posthog: 'posthog',
  meta: 'meta',
  tiktok: 'tiktok',
  google_ads: 'googleAds',
}

export interface PurchaseEvent {
  eventId: string
  orderNumber: string
  occurredAt: Date
  value: number
  shipping: number
  // Discount code used on the order, sent only to PostHog.
  coupon: string | null
  currency: 'THB'
  contents: Array<{ variantId: string, productId: string, quantity: number, unitPrice: number }>
  analyticsConsent: boolean
  marketingConsent: boolean
  posthogDistinctId: string | null
  // Shop-internal campaign attribution, stored regardless of consent and sent only to PostHog.
  attribution: {
    utmSource: string | null
    utmMedium: string | null
    utmCampaign: string | null
    utmContent: string | null
  }
  // Filled only when marketingConsent is true; otherwise every field is null.
  user: {
    emailSha256: string | null
    phoneSha256: string | null
    clientIp: string | null
    userAgent: string | null
    fbp: string | null
    fbc: string | null
    ttclid: string | null
    ttp: string | null
    gclid: string | null
    gbraid: string | null
    wbraid: string | null
  }
}

export class TrackingDeliveryError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code)
    this.name = 'TrackingDeliveryError'
  }
}

export interface TrackingAdapter {
  readonly destination: TrackingDestination
  readonly maxEventAgeMs: number
  send(event: PurchaseEvent): Promise<void>
}
