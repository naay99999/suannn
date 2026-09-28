import { expect, test } from 'bun:test'
import { addressSchema, emailChangeCodeSchema, profileNameSchema } from '../src/pages/account/account-forms'

const address = {
  label: 'บ้าน', recipientName: 'มะลิ ใจดี', phone: '0812345678',
  addressLine1: '24 ถนนสุขุมวิท', addressLine2: '', subdistrict: 'คลองตันเหนือ',
  district: 'วัฒนา', province: 'กรุงเทพมหานคร', postalCode: '10110',
}

test('profile name follows API text bounds after trimming', () => {
  expect(profileNameSchema.parse({ name: '  มะลิ  ' })).toEqual({ name: 'มะลิ' })
  expect(profileNameSchema.safeParse({ name: ' ' }).success).toBe(false)
  expect(profileNameSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false)
})

test('address schema accepts Thai contact fields and nullable second line', () => {
  expect(addressSchema.parse(address).postalCode).toBe('10110')
  expect(addressSchema.safeParse({ ...address, addressLine2: null }).success).toBe(true)
  expect(addressSchema.safeParse({ ...address, phone: '12345678' }).success).toBe(false)
  expect(addressSchema.safeParse({ ...address, postalCode: '1011' }).success).toBe(false)
  expect(addressSchema.safeParse({ ...address, label: 'a'.repeat(61) }).success).toBe(false)
})

test('email change code has exactly eight digits', () => {
  expect(emailChangeCodeSchema.safeParse({ code: '12345678' }).success).toBe(true)
  expect(emailChangeCodeSchema.safeParse({ code: '1234567' }).success).toBe(false)
  expect(emailChangeCodeSchema.safeParse({ code: '1234abcd' }).success).toBe(false)
})
