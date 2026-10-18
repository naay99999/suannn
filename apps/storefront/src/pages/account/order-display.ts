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

const settledStatuses: CustomerOrder['status'][] = ['delivered', 'cancelled']

export function isActiveOrder(order: Pick<CustomerOrder, 'status'>) {
  return !settledStatuses.includes(order.status)
}

// Fulfilment steps an active order moves through after payment.
export const fulfilmentSteps = ['placed', 'processing', 'packed', 'shipped'] as const satisfies CustomerOrder['status'][]

export function fulfilmentProgress(status: CustomerOrder['status']) {
  return fulfilmentSteps.indexOf(status as (typeof fulfilmentSteps)[number])
}

export function orderQuantity(order: Pick<CustomerOrder, 'items'>) {
  return order.items.reduce((sum, item) => sum + item.quantity, 0)
}

// Splits a long item list into a preview and the remainder shown on demand.
export function previewOrderItems<T>(items: T[], limit: number) {
  if (items.length <= limit + 1) return { shown: items, hidden: [] as T[] }
  return { shown: items.slice(0, limit), hidden: items.slice(limit) }
}

// A deadline later than today needs its date, not just the time.
export function formatDeadline(iso: string, now = new Date()) {
  const deadline = new Date(iso)
  const time = deadline.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  if (deadline.toDateString() === now.toDateString()) return `วันนี้ ${time} น.`
  return `${new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(deadline)} ${time} น.`
}

// Replaces one order inside cached cursor pages, keeping every other order untouched.
export function replaceOrderInPages<D extends { pages: { items: { id: string }[] }[] }>(data: D | undefined, next: D['pages'][number]['items'][number]): D | undefined {
  if (!data) return data
  return { ...data, pages: data.pages.map(page => ({ ...page, items: page.items.map(item => item.id === next.id ? next : item) })) }
}

export function findOrderInPages<T extends { id: string }>(data: { pages: { items: T[] }[] } | undefined, orderId: string) {
  for (const page of data?.pages ?? []) {
    const found = page.items.find(item => item.id === orderId)
    if (found) return found
  }
  return undefined
}

interface ContactAddress { name: string; phone: string; addressLine1: string; addressLine2: string | null; subdistrict: string; district: string; province: string; postalCode: string }

export function isSameContactAddress(a: ContactAddress, b: ContactAddress) {
  return a.name === b.name && a.phone === b.phone && a.addressLine1 === b.addressLine1 && (a.addressLine2 ?? '') === (b.addressLine2 ?? '')
    && a.subdistrict === b.subdistrict && a.district === b.district && a.province === b.province && a.postalCode === b.postalCode
}
