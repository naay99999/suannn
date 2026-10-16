import { expect, test } from 'bun:test'
import { shipmentCarrierLabel, shipmentTrackingUrl } from '../src/lib/shipment-tracking'

const shippedAt = '2026-10-16T03:00:00.000Z'

test('links known carriers to their tracking page with an encoded number', () => {
  const url = shipmentTrackingUrl({ carrier: 'thailand_post', carrierName: null, trackingNumber: 'EF123456789TH', shippedAt })
  expect(url).toBe('https://track.thailandpost.co.th/?trackNumber=EF123456789TH')
  for (const carrier of ['kerry', 'flash', 'jt'] as const) {
    expect(shipmentTrackingUrl({ carrier, carrierName: null, trackingNumber: 'AB-1234', shippedAt })?.startsWith('https://')).toBe(true)
  }
})

test('other carriers show their name without a tracking link', () => {
  const shipment = { carrier: 'other' as const, carrierName: 'Farm van', trackingNumber: 'VAN-0001', shippedAt }
  expect(shipmentTrackingUrl(shipment)).toBeNull()
  expect(shipmentCarrierLabel(shipment)).toBe('Farm van')
})
