import { z } from 'zod'
import type { CustomerAddress } from '@/pages/account/account-api'
import { normalizeThaiPhone, type CheckoutAddress } from '@/lib/store-checkout'

export const phoneMessage = 'กรุณากรอกเบอร์โทรศัพท์ 9–10 หลัก'

const addressSchema = z.object({
  // Id of the saved address the fields were copied from; empty for a hand-typed address.
  savedAddressId: z.string(),
  recipientName: z.string().trim().max(200),
  phone: z.string().trim().max(40),
  addressLine1: z.string().trim().max(300),
  addressLine2: z.string().trim().max(300),
  subdistrict: z.string().trim().max(200),
  district: z.string().trim().max(200),
  province: z.string().trim().max(200),
  postalCode: z.string().trim().max(5),
})

export type AddressFields = z.infer<typeof addressSchema>
export type AddressPrefix = 'billing' | 'shipping'

export const emptyAddressFields: AddressFields = {
  savedAddressId: '', recipientName: '', phone: '', addressLine1: '', addressLine2: '',
  subdistrict: '', district: '', province: '', postalCode: '',
}

const requiredAddressFields = ['recipientName', 'addressLine1', 'subdistrict', 'district', 'province'] as const

function checkAddress(prefix: AddressPrefix, value: AddressFields, ctx: z.RefinementCtx) {
  if (!/^[0-9]{9,10}$/.test(normalizeThaiPhone(value.phone))) ctx.addIssue({ code: 'custom', path: [prefix, 'phone'], message: phoneMessage })
  for (const field of requiredAddressFields) {
    if (!value[field].trim()) ctx.addIssue({ code: 'custom', path: [prefix, field], message: 'กรุณากรอกข้อมูลที่อยู่ให้ครบ' })
  }
  if (!/^[0-9]{5}$/.test(value.postalCode.trim())) ctx.addIssue({ code: 'custom', path: [prefix, 'postalCode'], message: 'รหัสไปรษณีย์ต้องมี 5 หลัก' })
}

export const checkoutSchema = z.object({
  email: z.email('กรุณากรอกอีเมลให้ถูกต้อง').max(320),
  billing: addressSchema,
  shipDifferent: z.boolean(),
  shipping: addressSchema,
}).superRefine((values, ctx) => {
  checkAddress('billing', values.billing, ctx)
  // The shipping section is only validated (and sent) when the customer ships elsewhere.
  if (values.shipDifferent) checkAddress('shipping', values.shipping, ctx)
})

export type CheckoutForm = z.infer<typeof checkoutSchema>

const copiedFields = ['recipientName', 'phone', 'addressLine1', 'addressLine2', 'subdistrict', 'district', 'province', 'postalCode'] as const

export function savedAddressFormValues(address: CustomerAddress): AddressFields {
  return {
    savedAddressId: address.id, recipientName: address.recipientName, phone: address.phone, addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? '', subdistrict: address.subdistrict, district: address.district, province: address.province, postalCode: address.postalCode,
  }
}

export function savedAddressLine(address: CustomerAddress) {
  return [address.addressLine1, address.addressLine2, address.subdistrict, address.district, address.province, address.postalCode].filter(Boolean).join(' ')
}

function normalizedField(field: (typeof copiedFields)[number], value: string) {
  return field === 'phone' ? normalizeThaiPhone(value.trim()) : value.trim()
}

// Send the saved address by reference only while every copied field, phone included, is untouched.
export function addressPayload(values: AddressFields, saved?: CustomerAddress): CheckoutAddress {
  if (saved) {
    const original = savedAddressFormValues(saved)
    if (copiedFields.every(field => normalizedField(field, values[field]) === normalizedField(field, original[field]))) return { addressId: saved.id }
  }
  return {
    recipientName: values.recipientName.trim(),
    phone: normalizeThaiPhone(values.phone.trim()),
    addressLine1: values.addressLine1.trim(),
    ...(values.addressLine2.trim() ? { addressLine2: values.addressLine2.trim() } : {}),
    subdistrict: values.subdistrict.trim(),
    district: values.district.trim(),
    province: values.province.trim(),
    postalCode: values.postalCode.trim(),
  }
}
