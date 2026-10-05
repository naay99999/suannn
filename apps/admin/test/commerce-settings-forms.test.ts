import { expect, test } from 'bun:test'
import { parseCommerceSettings } from '../src/lib/commerce-settings/forms'

test('parses an unset disabled fee, zero and exact baht decimals', () => {
  expect(parseCommerceSettings({ shippingFeeBaht: '', checkoutEnabled: false })).toEqual({ shippingFeeSatang: null, checkoutEnabled: false })
  expect(parseCommerceSettings({ shippingFeeBaht: '0', checkoutEnabled: false })).toEqual({ shippingFeeSatang: 0, checkoutEnabled: false })
  expect(parseCommerceSettings({ shippingFeeBaht: '35.50', checkoutEnabled: true })).toEqual({ shippingFeeSatang: 3550, checkoutEnabled: true })
})

test('rejects invalid decimals, negative values, overflow and enabled checkout without a fee', () => {
  for (const shippingFeeBaht of ['1.234', '-1', '21474836.48']) {
    expect(() => parseCommerceSettings({ shippingFeeBaht, checkoutEnabled: false })).toThrow()
  }
  expect(() => parseCommerceSettings({ shippingFeeBaht: '', checkoutEnabled: true })).toThrow('ต้องกำหนดค่าจัดส่ง')
})
