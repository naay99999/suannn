import { parseBahtToSatang } from '@/lib/format'
import type { CommerceSettingsInput } from './api'

const maximumIntegerSatang = 2_147_483_647

export function parseCommerceSettings(values: { shippingFeeBaht: string; checkoutEnabled: boolean }): CommerceSettingsInput {
  const feeInput = values.shippingFeeBaht.trim()
  const shippingFeeSatang = feeInput ? parseBahtToSatang(feeInput) : null
  if (shippingFeeSatang !== null && shippingFeeSatang > maximumIntegerSatang) throw new Error('ค่าจัดส่งสูงเกินขอบเขตที่ระบบรองรับ')
  if (values.checkoutEnabled && shippingFeeSatang === null) throw new Error('ต้องกำหนดค่าจัดส่งก่อนเปิด checkout')
  return { shippingFeeSatang, checkoutEnabled: values.checkoutEnabled }
}
