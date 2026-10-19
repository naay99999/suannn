import type { OrderCommand, OrderDetail } from './api'

type BadgeTone = 'success' | 'warning' | 'info' | 'destructive' | 'outline'
type FulfillmentStatus = 'processing' | 'packed' | 'shipped' | 'delivered'

export const orderStatusLabels: Record<OrderDetail['status'], { label: string; tone: BadgeTone }> = {
  pending_payment: { label: 'รอชำระเงิน', tone: 'warning' },
  placed: { label: 'ได้รับคำสั่งซื้อ', tone: 'info' },
  processing: { label: 'กำลังเตรียมสินค้า', tone: 'info' },
  packed: { label: 'แพ็กแล้ว', tone: 'info' },
  shipped: { label: 'จัดส่งแล้ว', tone: 'info' },
  delivered: { label: 'ส่งถึงแล้ว', tone: 'success' },
  cancelled: { label: 'ยกเลิกแล้ว', tone: 'destructive' },
}

export const paymentStatusLabels: Record<OrderDetail['payment']['status'], { label: string; tone: BadgeTone }> = {
  awaiting_collection: { label: 'รอเก็บเงิน', tone: 'warning' },
  collected: { label: 'ชำระแล้ว', tone: 'success' },
  void: { label: 'ยกเลิกการชำระ', tone: 'outline' },
}

export const refundStatusLabels: Record<NonNullable<OrderDetail['payment']['refund']>['status'], { label: string; tone: BadgeTone }> = {
  pending: { label: 'กำลังคืนเงิน', tone: 'info' },
  requires_action: { label: 'ต้องดำเนินการเพิ่ม', tone: 'warning' },
  succeeded: { label: 'คืนเงินสำเร็จ', tone: 'success' },
  failed: { label: 'คืนเงินไม่สำเร็จ', tone: 'destructive' },
  canceled: { label: 'ยกเลิกการคืนเงิน', tone: 'outline' },
}

export const paymentMethodLabels: Record<OrderDetail['paymentMethod'], string> = { cod: 'เก็บเงินปลายทาง', stripe: 'บัตร / Stripe' }

export const fulfillmentSteps: { status: Exclude<OrderDetail['status'], 'pending_payment' | 'cancelled'>; label: string }[] = [
  { status: 'placed', label: 'ได้รับคำสั่งซื้อ' },
  { status: 'processing', label: 'เตรียมสินค้า' },
  { status: 'packed', label: 'แพ็กแล้ว' },
  { status: 'shipped', label: 'จัดส่งแล้ว' },
  { status: 'delivered', label: 'ส่งถึงแล้ว' },
]

export const fulfillmentActionLabels: Record<FulfillmentStatus, string> = {
  processing: 'เริ่มเตรียมสินค้า',
  packed: 'บันทึกว่าแพ็กแล้ว',
  shipped: 'จัดส่งพัสดุ',
  delivered: 'ยืนยันส่งถึงแล้ว',
}

export const commandLabels: Record<Exclude<OrderCommand['kind'], 'fulfillment'>, string> = {
  cancel: 'ยกเลิกคำสั่งซื้อ',
  collectCod: 'รับเงินปลายทาง',
  refund: 'คืนเงิน',
  reissue: 'ส่งลิงก์ติดตามใหม่',
  revoke: 'เพิกถอนลิงก์ติดตาม',
  issueReceipt: 'ออกใบเสร็จ',
  cancelReceipt: 'ยกเลิกใบเสร็จ',
}
