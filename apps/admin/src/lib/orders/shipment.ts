import type { FulfillmentInput, OrderDetail } from './api'

export type Carrier = NonNullable<FulfillmentInput['shipment']>['carrier']

export const carrierLabels: Record<Carrier, string> = {
  thailand_post: 'ไปรษณีย์ไทย',
  kerry: 'Kerry Express',
  flash: 'Flash Express',
  jt: 'J&T Express',
  other: 'อื่นๆ',
}

export const trackingNumberPattern = /^[A-Za-z0-9-]{4,40}$/

export function shipmentCarrierLabel(shipment: NonNullable<OrderDetail['shipment']>): string {
  return shipment.carrier === 'other' && shipment.carrierName ? shipment.carrierName : carrierLabels[shipment.carrier]
}
