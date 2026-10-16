import type { StoreOrderDetail } from '@/lib/store-orders'

export type StoreShipment = NonNullable<StoreOrderDetail['shipment']>

const carrierLabels: Record<StoreShipment['carrier'], string> = {
  thailand_post: 'ไปรษณีย์ไทย',
  kerry: 'Kerry Express',
  flash: 'Flash Express',
  jt: 'J&T Express',
  other: 'ขนส่งของร้าน',
}

// Public tracking pages; "other" carriers have no known tracking site.
const trackingUrls: Partial<Record<StoreShipment['carrier'], (trackingNumber: string) => string>> = {
  thailand_post: number => `https://track.thailandpost.co.th/?trackNumber=${number}`,
  kerry: number => `https://th.kerryexpress.com/th/track/?track=${number}`,
  flash: number => `https://www.flashexpress.co.th/fle/tracking?se=${number}`,
  jt: number => `https://www.jtexpress.co.th/index/query/gzquery.html?bills=${number}`,
}

export function shipmentCarrierLabel(shipment: StoreShipment): string {
  return shipment.carrier === 'other' && shipment.carrierName ? shipment.carrierName : carrierLabels[shipment.carrier]
}

export function shipmentTrackingUrl(shipment: StoreShipment): string | null {
  return trackingUrls[shipment.carrier]?.(encodeURIComponent(shipment.trackingNumber)) ?? null
}
