import { z } from 'zod'
import { parseBahtToSatang } from '../format'
import { bangkokInputToIso } from '../inventory/forms'
import type { Discount, DiscountInput, DiscountUpdateInput } from './api'

export type DiscountKind = Discount['kind']
export type Eligibility = 'all' | 'categories' | 'products'

// Numeric inputs stay as text so an empty box means "no limit" and never becomes 0.
export interface DiscountFormValues {
  code: string
  name: string
  kind: DiscountKind
  percentOff: string
  amountOffBaht: string
  maxDiscountBaht: string
  minSubtotalBaht: string
  minQuantity: string
  eligibility: Eligibility
  categories: string[]
  productIds: string[]
  startsAt: string
  endsAt: string
  usageLimit: string
  perCustomerLimit: string
  allowedEmails: string
  firstOrderOnly: boolean
  active: boolean
}

export const emptyDiscountValues: DiscountFormValues = {
  code: '',
  name: '',
  kind: 'percent',
  percentOff: '',
  amountOffBaht: '',
  maxDiscountBaht: '',
  minSubtotalBaht: '',
  minQuantity: '',
  eligibility: 'all',
  categories: [],
  productIds: [],
  startsAt: '',
  endsAt: '',
  usageLimit: '',
  perCustomerLimit: '',
  allowedEmails: '',
  firstOrderOnly: false,
  active: true,
}

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const POSITIVE_INTEGER = /^[1-9]\d{0,8}$/

// 10 characters from A-Z and 2-9. Bytes at or above the largest multiple of 34 are rejected so every symbol is equally likely.
export function randomDiscountCode(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length)
  let code = ''
  while (code.length < 10) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && code.length < 10) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
    }
  }
  return code
}

const blank = (value: string) => value.trim() === ''

function bahtToSatang(value: string): number | null {
  try {
    return parseBahtToSatang(value)
  } catch {
    return null
  }
}

export function parseEmailLines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

// Bangkok has no DST, so wall time maps to UTC with a fixed +07:00 offset.
export function bangkokIsoToInput(value: string | Date | null | undefined): string {
  if (!value) return ''
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  if (Number.isNaN(time)) return ''
  return new Date(time + 7 * 3_600_000).toISOString().slice(0, 16)
}

function validInstant(value: string): number | null {
  try {
    return Date.parse(bangkokInputToIso(value))
  } catch {
    return null
  }
}

export const discountFormSchema = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.enum(['percent', 'fixed', 'free_shipping']),
  percentOff: z.string(),
  amountOffBaht: z.string(),
  maxDiscountBaht: z.string(),
  minSubtotalBaht: z.string(),
  minQuantity: z.string(),
  eligibility: z.enum(['all', 'categories', 'products']),
  categories: z.array(z.string()),
  productIds: z.array(z.string()),
  startsAt: z.string(),
  endsAt: z.string(),
  usageLimit: z.string(),
  perCustomerLimit: z.string(),
  allowedEmails: z.string(),
  firstOrderOnly: z.boolean(),
  active: z.boolean(),
}).superRefine((values, ctx) => {
  const fail = (path: keyof DiscountFormValues, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  const code = values.code.trim().toUpperCase()
  if (!/^[A-Z0-9-]{3,32}$/.test(code)) fail('code', 'โค้ดต้องยาว 3-32 ตัว ใช้ได้เฉพาะ A-Z ตัวเลข และขีดกลาง')
  const name = values.name.trim()
  if (name.length < 1) fail('name', 'กรุณาระบุชื่อโค้ด')
  else if (name.length > 100) fail('name', 'ชื่อโค้ดต้องไม่เกิน 100 ตัวอักษร')

  if (values.kind === 'percent') {
    if (!/^\d+$/.test(values.percentOff.trim()) || Number(values.percentOff) < 1 || Number(values.percentOff) > 100) fail('percentOff', 'ระบุเปอร์เซ็นต์เป็นจำนวนเต็ม 1-100')
    if (!blank(values.maxDiscountBaht) && (bahtToSatang(values.maxDiscountBaht) ?? 0) < 1) fail('maxDiscountBaht', 'ระบุจำนวนเงินมากกว่า 0 หรือเว้นว่าง')
  }
  if (values.kind === 'fixed' && (bahtToSatang(values.amountOffBaht) ?? 0) < 1) fail('amountOffBaht', 'ระบุจำนวนเงินที่ลดมากกว่า 0 บาท')
  if (!blank(values.minSubtotalBaht) && (bahtToSatang(values.minSubtotalBaht) ?? 0) < 1) fail('minSubtotalBaht', 'ระบุจำนวนเงินมากกว่า 0 หรือเว้นว่าง')

  for (const field of ['minQuantity', 'usageLimit', 'perCustomerLimit'] as const) {
    if (!blank(values[field]) && !POSITIVE_INTEGER.test(values[field].trim())) fail(field, 'ระบุจำนวนเต็มตั้งแต่ 1 ขึ้นไป หรือเว้นว่างถ้าไม่จำกัด')
  }

  if (values.eligibility === 'categories' && values.categories.length === 0) fail('categories', 'เลือกอย่างน้อยหนึ่งหมวด')
  if (values.eligibility === 'products' && values.productIds.length === 0) fail('productIds', 'เลือกอย่างน้อยหนึ่งสินค้า')

  const start = blank(values.startsAt) ? null : validInstant(values.startsAt)
  const end = blank(values.endsAt) ? null : validInstant(values.endsAt)
  if (!blank(values.startsAt) && start === null) fail('startsAt', 'วันและเวลาไม่ถูกต้อง')
  if (!blank(values.endsAt) && end === null) fail('endsAt', 'วันและเวลาไม่ถูกต้อง')
  if (start !== null && end !== null && end <= start) fail('endsAt', 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม')

  const emails = parseEmailLines(values.allowedEmails)
  if (emails.length > 2000) fail('allowedEmails', 'ใส่อีเมลได้ไม่เกิน 2,000 รายการ')
  else if (emails.some((email) => !EMAIL_PATTERN.test(email))) fail('allowedEmails', 'มีอีเมลที่รูปแบบไม่ถูกต้อง (หนึ่งอีเมลต่อบรรทัด)')
})

const intOrNull = (value: string) => (blank(value) ? null : Number(value))
const satangOrNull = (value: string) => (blank(value) ? null : parseBahtToSatang(value))

// The update route replaces the whole record: every field is sent, with null for "no limit".
export function toDiscountInput(values: DiscountFormValues): DiscountInput {
  const percent = values.kind === 'percent'
  return {
    code: values.code.trim().toUpperCase(),
    name: values.name.trim(),
    kind: values.kind,
    percentOff: percent ? Number(values.percentOff) : null,
    amountOffSatang: values.kind === 'fixed' ? parseBahtToSatang(values.amountOffBaht) : null,
    maxDiscountSatang: percent ? satangOrNull(values.maxDiscountBaht) : null,
    minSubtotalSatang: satangOrNull(values.minSubtotalBaht),
    minQuantity: intOrNull(values.minQuantity),
    eligibleCategories: values.eligibility === 'categories' ? values.categories : [],
    eligibleProductIds: values.eligibility === 'products' ? values.productIds : [],
    startsAt: blank(values.startsAt) ? null : bangkokInputToIso(values.startsAt),
    endsAt: blank(values.endsAt) ? null : bangkokInputToIso(values.endsAt),
    usageLimit: intOrNull(values.usageLimit),
    perCustomerLimit: intOrNull(values.perCustomerLimit),
    allowedEmails: parseEmailLines(values.allowedEmails),
    firstOrderOnly: values.firstOrderOnly,
    active: values.active,
  }
}

export function toDiscountUpdateInput(values: DiscountFormValues, version: number): DiscountUpdateInput {
  return { ...toDiscountInput(values), version }
}

const bahtText = (satang: number | null) => (satang === null ? '' : String(satang / 100))
const numberText = (value: number | null) => (value === null ? '' : String(value))

export function discountToFormValues(discount: Discount): DiscountFormValues {
  return {
    code: discount.code,
    name: discount.name,
    kind: discount.kind,
    percentOff: numberText(discount.percentOff),
    amountOffBaht: bahtText(discount.amountOffSatang),
    maxDiscountBaht: bahtText(discount.maxDiscountSatang),
    minSubtotalBaht: bahtText(discount.minSubtotalSatang),
    minQuantity: numberText(discount.minQuantity),
    eligibility: discount.eligibleProductIds.length > 0 ? 'products' : discount.eligibleCategories.length > 0 ? 'categories' : 'all',
    categories: discount.eligibleCategories,
    productIds: discount.eligibleProductIds,
    startsAt: bangkokIsoToInput(discount.startsAt),
    endsAt: bangkokIsoToInput(discount.endsAt),
    usageLimit: numberText(discount.usageLimit),
    perCustomerLimit: numberText(discount.perCustomerLimit),
    allowedEmails: discount.allowedEmails.join('\n'),
    firstOrderOnly: discount.firstOrderOnly,
    active: discount.active,
  }
}
