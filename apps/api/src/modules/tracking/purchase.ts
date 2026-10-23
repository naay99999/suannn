import { desc, eq, and } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { commerceOrder, orderAttribution, orderEvent, orderItem, trackingOutbox } from '../../database/schema'
import { hashedContact } from './identity'
import type { PurchaseEvent, TrackingDestination } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

// Single source for adapter maxEventAgeMs. Meta CAPI and TikTok Events API
// accept events up to 7 days old; Google Ads offline conversions allow 90 days.
export const MAX_EVENT_AGE_MS: Record<TrackingDestination, number> = {
  posthog: 30 * DAY_MS,
  meta: 7 * DAY_MS,
  tiktok: 7 * DAY_MS,
  google_ads: 90 * DAY_MS,
}

export function eligibleDestinations(attribution: {
  marketingConsent: boolean
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
}): TrackingDestination[] {
  const destinations: TrackingDestination[] = ['posthog']

  if (!attribution.marketingConsent) return destinations

  destinations.push('meta', 'tiktok')
  if (attribution.gclid || attribution.gbraid || attribution.wbraid) destinations.push('google_ads')

  return destinations
}

export async function enqueuePurchaseTracking(tx: DatabaseTransaction, orderId: string, occurredAt: Date): Promise<void> {
  const [attribution] = await tx
    .select({
      marketingConsent: orderAttribution.marketingConsent,
      gclid: orderAttribution.gclid,
      gbraid: orderAttribution.gbraid,
      wbraid: orderAttribution.wbraid,
    })
    .from(orderAttribution)
    .where(eq(orderAttribution.orderId, orderId))
    .limit(1)

  const destinations = eligibleDestinations(attribution ?? { marketingConsent: false, gclid: null, gbraid: null, wbraid: null })

  await tx
    .insert(trackingOutbox)
    .values(destinations.map((destination) => ({
      orderId,
      destination,
      eventName: 'purchase' as const,
      expiresAt: new Date(occurredAt.getTime() + MAX_EVENT_AGE_MS[destination]),
    })))
    .onConflictDoNothing()
}

export async function loadPurchaseEvent(db: Database, orderId: string): Promise<PurchaseEvent | null> {
  const [order] = await db
    .select({
      id: commerceOrder.id,
      orderNumber: commerceOrder.orderNumber,
      contactEmail: commerceOrder.contactEmail,
      contactPhone: commerceOrder.contactPhone,
      subtotalSatang: commerceOrder.subtotalSatang,
      discountSatang: commerceOrder.discountSatang,
      discountCode: commerceOrder.discountCode,
      shippingSatang: commerceOrder.shippingSatang,
    })
    .from(commerceOrder)
    .where(eq(commerceOrder.id, orderId))
    .limit(1)

  if (!order) return null

  const [placed] = await db
    .select({ createdAt: orderEvent.createdAt })
    .from(orderEvent)
    .where(and(eq(orderEvent.orderId, orderId), eq(orderEvent.eventType, 'order.placed')))
    .orderBy(desc(orderEvent.createdAt))
    .limit(1)

  if (!placed) return null

  const items = await db
    .select({
      variantId: orderItem.variantId,
      productId: orderItem.productId,
      quantity: orderItem.quantity,
      unitPriceSatang: orderItem.unitPriceSatang,
    })
    .from(orderItem)
    .where(eq(orderItem.orderId, orderId))
    .orderBy(orderItem.createdAt, orderItem.id)

  const [attribution] = await db
    .select()
    .from(orderAttribution)
    .where(eq(orderAttribution.orderId, orderId))
    .limit(1)

  const marketingConsent = attribution?.marketingConsent ?? false
  const hashes = marketingConsent ? hashedContact(order.contactEmail, order.contactPhone) : null

  return {
    eventId: order.id,
    orderNumber: order.orderNumber,
    occurredAt: placed.createdAt,
    value: (order.subtotalSatang - order.discountSatang) / 100,
    shipping: order.shippingSatang / 100,
    coupon: order.discountCode,
    currency: 'THB',
    contents: items.map((item) => ({
      variantId: item.variantId,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPriceSatang / 100,
    })),
    analyticsConsent: attribution?.analyticsConsent ?? false,
    marketingConsent,
    posthogDistinctId: attribution?.analyticsConsent ? attribution.posthogDistinctId ?? null : null,
    attribution: {
      utmSource: attribution?.utmSource ?? null,
      utmMedium: attribution?.utmMedium ?? null,
      utmCampaign: attribution?.utmCampaign ?? null,
      utmContent: attribution?.utmContent ?? null,
    },
    user: {
      emailSha256: hashes?.emailSha256 ?? null,
      phoneSha256: hashes?.phoneSha256 ?? null,
      clientIp: marketingConsent ? attribution?.clientIp ?? null : null,
      userAgent: marketingConsent ? attribution?.userAgent ?? null : null,
      fbp: marketingConsent ? attribution?.fbp ?? null : null,
      fbc: marketingConsent ? attribution?.fbc ?? null : null,
      ttclid: marketingConsent ? attribution?.ttclid ?? null : null,
      ttp: marketingConsent ? attribution?.ttp ?? null : null,
      gclid: marketingConsent ? attribution?.gclid ?? null : null,
      gbraid: marketingConsent ? attribution?.gbraid ?? null : null,
      wbraid: marketingConsent ? attribution?.wbraid ?? null : null,
    },
  }
}
