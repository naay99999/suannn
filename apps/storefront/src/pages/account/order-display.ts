import type { CustomerOrder } from './account-api'

export const orderStatusLabels: Record<CustomerOrder['status'], string> = {
  pending_payment: 'รอชำระเงิน',
  placed: 'รับรายการแล้ว',
  processing: 'กำลังเตรียมสินค้า',
  packed: 'แพ็กสินค้าแล้ว',
  shipped: 'จัดส่งแล้ว',
  delivered: 'ส่งถึงแล้ว',
  cancelled: 'ยกเลิกแล้ว',
}

export function formatSatang(satang: number) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency', currency: 'THB', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(satang / 100)
}

export function formatOrderDate(date: string) {
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(date))
}

export function latestOrder<T extends { createdAt: string }>(orders: T[]): T | undefined {
  return [...orders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
}

export function mergeOrderPages<T extends { id: string }>(pages: { items: T[] }[]): T[] {
  const seen = new Set<string>()
  return pages.flatMap(page => page.items.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  }))
}
