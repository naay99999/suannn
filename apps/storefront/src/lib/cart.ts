import type { SkippedCartLine, StoreCartDetail, StoreCartLine } from './store-cart'

export const legacyCartStorageKey = 'suannn-cart-v1'
export const MAX_QUANTITY = 99

export function discardLegacyCart(storage: Pick<Storage, 'removeItem'>) {
  storage.removeItem(legacyCartStorageKey)
}

export function hasUnavailableCartLines(lines: readonly (Pick<StoreCartLine, 'canPurchase' | 'issues'> & { priceSatang?: number | null })[]): boolean {
  return lines.some(line => !line.canPurchase || line.issues.length > 0 || line.priceSatang === null)
}

export function cartMergeNotice(skipped: readonly SkippedCartLine[]): string | null {
  if (!skipped.length) return null
  return `มีสินค้า ${skipped.length} รายการที่เพิ่มเข้าตะกร้าบัญชีไม่ได้ เนื่องจากสินค้าไม่พร้อมหรือมีจำนวนจำกัด โปรดตรวจสอบรายการด้านล่าง`
}

export function getCartSummary(cart: StoreCartDetail) {
  const lines = cart.lines.map(line => ({
    ...line,
    totalSatang: line.priceSatang === null ? null : line.priceSatang * line.quantity,
  }))
  return {
    lines,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalSatang: lines.reduce((sum, line) => sum + (line.totalSatang ?? 0), 0),
    hasUnavailable: hasUnavailableCartLines(lines),
  }
}
