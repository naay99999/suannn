import { formatMoney } from '../format'
import type { Discount } from './api'

type BadgeTone = 'success' | 'warning' | 'info' | 'destructive' | 'outline'

export const discountStatusLabels: Record<Discount['status'], { label: string; tone: BadgeTone }> = {
  active: { label: 'ใช้งานอยู่', tone: 'success' },
  scheduled: { label: 'รอเริ่ม', tone: 'info' },
  paused: { label: 'หยุดชั่วคราว', tone: 'outline' },
  expired: { label: 'หมดอายุ', tone: 'warning' },
  used_up: { label: 'ใช้ครบแล้ว', tone: 'warning' },
}

export const discountKindLabels: Record<Discount['kind'], string> = {
  percent: 'ลดเป็นเปอร์เซ็นต์',
  fixed: 'ลดเป็นจำนวนเงิน',
  free_shipping: 'ส่งฟรี',
}

export const categoryLabels = { fresh: 'ผลไม้สด', processed: 'แปรรูป' } as const

type ValueFields = Pick<Discount, 'kind' | 'percentOff' | 'amountOffSatang' | 'maxDiscountSatang'>

const baht = (satang: number) => formatMoney(satang).replace(/\.00$/, '')

// ลด 10% (สูงสุด ฿200) / ลด ฿100 / ส่งฟรี
export function discountValueText(discount: ValueFields): string {
  if (discount.kind === 'free_shipping') return 'ส่งฟรี'
  if (discount.kind === 'fixed') return `ลด ${baht(discount.amountOffSatang ?? 0)}`
  const cap = discount.maxDiscountSatang === null ? '' : ` (สูงสุด ${baht(discount.maxDiscountSatang)})`
  return `ลด ${discount.percentOff ?? 0}%${cap}`
}

export function discountUsesText(discount: Pick<Discount, 'uses' | 'usageLimit'>): string {
  return `${discount.uses} / ${discount.usageLimit ?? '∞'}`
}
