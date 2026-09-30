export type ReturnMode = 'success' | 'cancel'

export function checkoutReturnMessage(mode: ReturnMode, order: { paymentMethod: 'cod' | 'stripe'; status: string; paymentStatus: string }) {
  if (mode === 'cancel') return 'กลับจากหน้าชำระเงินแล้ว คำสั่งซื้อยังไม่ได้ยกเลิก และอาจยังรอผลจาก Stripe'
  if (order.status === 'pending_payment' || order.paymentStatus === 'awaiting_collection') return 'รอการยืนยันการชำระเงินจาก Stripe เราจะแสดงสถานะใหม่เมื่อ API ได้รับผลจาก webhook'
  if (order.paymentStatus === 'collected') return 'Stripe ยืนยันการชำระเงินแล้ว'
  return 'สถานะคำสั่งซื้อได้รับการอัปเดตจากร้าน'
}

export function missingCheckoutContextMessage(kind: 'guest' | 'customer') {
  return kind === 'guest'
    ? 'ไม่พบข้อมูลกลับจากหน้าชำระเงินในแท็บนี้ ตรวจอีเมลยืนยันเพื่อเปิดคำสั่งซื้อ หรือกรอก guest access token ที่หน้า guest order'
    : 'ไม่พบข้อมูลกลับจากหน้าชำระเงินในแท็บนี้ เข้าสู่บัญชีเพื่อค้นหาคำสั่งซื้อของคุณ'
}
