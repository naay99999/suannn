import { describe, expect, test } from 'bun:test'
import { checkoutAddressDefaultValue, checkoutAddressFields } from '../src/pages/checkout/checkout-address'

describe('checkoutAddressFields', () => {
  test('copies a selected Thai locality into the checkout payload', () => {
    expect(checkoutAddressFields({
      subdistrict: 'ลาดพร้าว',
      district: 'ลาดพร้าว',
      province: 'กรุงเทพมหานคร',
      postalCode: '10230',
    })).toEqual({
      subdistrict: 'ลาดพร้าว',
      district: 'ลาดพร้าว',
      province: 'กรุงเทพมหานคร',
      postalCode: '10230',
    })
  })

  test('clears stale locality fields when the selected area is invalidated', () => {
    expect(checkoutAddressFields(null)).toEqual({
      subdistrict: '',
      district: '',
      province: '',
      postalCode: '',
    })
  })

  test('restores a completed selection when returning from confirmation', () => {
    expect(checkoutAddressDefaultValue({
      subdistrict: 'ลาดพร้าว',
      district: 'ลาดพร้าว',
      province: 'กรุงเทพมหานคร',
      postalCode: '10230',
    })).toMatchObject({
      subdistrict: 'ลาดพร้าว',
      district: 'ลาดพร้าว',
      province: 'กรุงเทพมหานคร',
      postalCode: '10230',
      tambon: 'ลาดพร้าว',
      amphure: 'ลาดพร้าว',
      zipCode: '10230',
    })
  })
})
