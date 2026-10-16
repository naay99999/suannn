import { formatOrderDate } from '@/pages/account/order-display'
import { shipmentCarrierLabel, shipmentTrackingUrl, type StoreShipment } from '@/lib/shipment-tracking'

export function ShipmentDetails({ shipment }: { shipment: StoreShipment }) {
  const trackingUrl = shipmentTrackingUrl(shipment)
  return (
    <div className="flex flex-col gap-1 text-sm leading-7">
      <p>{shipmentCarrierLabel(shipment)} · ส่งเมื่อ {formatOrderDate(shipment.shippedAt)}</p>
      <p>เลขพัสดุ <span className="font-mono font-medium">{shipment.trackingNumber}</span></p>
      {trackingUrl && <a className="font-medium text-primary-ink underline underline-offset-4" href={trackingUrl} target="_blank" rel="noopener noreferrer">ติดตามพัสดุกับ{shipmentCarrierLabel(shipment)}</a>}
    </div>
  )
}
