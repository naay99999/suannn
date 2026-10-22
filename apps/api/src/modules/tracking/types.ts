import type { TrackingConfig } from '../../config/env'

export type TrackingConfigOf<K extends 'posthog' | 'meta' | 'tiktok' | 'googleAds'> = NonNullable<TrackingConfig[K]>

export type TrackingDestination = 'posthog' | 'meta' | 'tiktok' | 'google_ads'

export interface PurchaseEvent {
  eventId: string
  orderNumber: string
  occurredAt: Date
  value: number
  shipping: number
  currency: 'THB'
  contents: Array<{ variantId: string, productId: string, quantity: number, unitPrice: number }>
  analyticsConsent: boolean
  marketingConsent: boolean
  posthogDistinctId: string | null
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
