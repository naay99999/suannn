import { z } from 'zod'
import type {
  CountAdjustmentInput,
  QuarantineInput,
  ReserveInput,
  ReceiveInput,
  WriteOffInput,
} from './api'

export function bangkokInputToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error('เวลาต้องอยู่ในรูปแบบ YYYY-MM-DDTHH:mm')

  const [, yearValue, monthValue, dayValue, hourValue, minuteValue] = match
  const year = Number(yearValue)
  const month = Number(monthValue)
  const day = Number(dayValue)
  const hour = Number(hourValue)
  const minute = Number(minuteValue)
  const daysInMonth = month === 2
    ? year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 29 : 28
    : [4, 6, 9, 11].includes(month) ? 30 : 31

  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59) {
    throw new Error('วันที่หรือเวลาไม่ถูกต้อง')
  }

  return new Date(`${value}:00+07:00`).toISOString()
}

function validDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return year >= 1
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function validBangkokInput(value: string): boolean {
  if (!value) return true
  try {
    bangkokInputToIso(value)
    return true
  } catch {
    return false
  }
}

export const receiveLotSchema = z.object({
  lotCode: z.string().trim().min(1, 'กรุณาระบุรหัสล็อต').max(102, 'รหัสล็อตต้องไม่เกิน 102 ตัวอักษร'),
  quantity: z.number().int('จำนวนต้องเป็นจำนวนเต็ม').min(1, 'จำนวนต้องไม่น้อยกว่า 1').max(1_000_000_000, 'จำนวนเกินขีดจำกัด'),
  expiryDate: z.string().refine(validDateOnly, 'กรุณาระบุวันหมดอายุที่ถูกต้อง'),
  receivedAt: z.string().refine(validBangkokInput, 'กรุณาระบุวันและเวลาที่ถูกต้อง'),
  quarantined: z.boolean(),
  quarantineReason: z.string(),
}).superRefine((values, context) => {
  if (!values.quarantined) return
  const reason = values.quarantineReason.trim()
  if (!reason) context.addIssue({ code: 'custom', path: ['quarantineReason'], message: 'กรุณาระบุเหตุผลกักกัน' })
  if (reason.length > 200) context.addIssue({ code: 'custom', path: ['quarantineReason'], message: 'เหตุผลต้องไม่เกิน 200 ตัวอักษร' })
})

export const quarantineSchema = z.object({
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลกักกัน').max(200, 'เหตุผลต้องไม่เกิน 200 ตัวอักษร'),
})

export const writeOffSchema = z.object({
  quantity: z.number().int('จำนวนต้องเป็นจำนวนเต็ม').min(1, 'จำนวนต้องไม่น้อยกว่า 1').max(1_000_000_000, 'จำนวนเกินขีดจำกัด'),
  reason: z.enum(['spoiled', 'expired', 'damaged'], { error: 'กรุณาเลือกเหตุผลการตัดสต็อก' }),
  note: z.string().trim().max(200, 'หมายเหตุต้องไม่เกิน 200 ตัวอักษร'),
})

export const countAdjustmentSchema = z.object({
  countedQuantity: z.number().int('จำนวนต้องเป็นจำนวนเต็ม').min(0, 'ยอดนับจริงต้องไม่ต่ำกว่า 0').max(1_000_000_000, 'จำนวนเกินขีดจำกัด'),
  reason: z.string().trim().min(1, 'กรุณาระบุรหัสเหตุผล').max(100, 'รหัสเหตุผลต้องไม่เกิน 100 ตัวอักษร').regex(/^[a-z][a-z0-9._-]{0,99}$/, 'ใช้ตัวพิมพ์เล็ก ตัวเลข จุด ขีด หรือขีดล่าง โดยขึ้นต้นด้วยตัวอักษร'),
})

export const reservationSchema = z.object({
  lines: z.array(z.object({
    variantId: z.uuid('กรุณาเลือกรูปแบบสินค้าที่ถูกต้อง'),
    quantity: z.number().int('จำนวนต้องเป็นจำนวนเต็ม').min(1, 'จำนวนต้องไม่น้อยกว่า 1').max(1_000_000, 'จำนวนต้องไม่เกิน 1,000,000'),
  })).min(1, 'กรุณาเพิ่มรูปแบบสินค้าอย่างน้อย 1 รายการ').max(50, 'เพิ่มรูปแบบสินค้าได้ไม่เกิน 50 รายการ'),
  externalReference: z.string().trim().max(255, 'รหัสอ้างอิงต้องไม่เกิน 255 ตัวอักษร').optional(),
}).superRefine((values, context) => {
  const variantIds = new Set<string>()
  values.lines.forEach((line, index) => {
    if (variantIds.has(line.variantId)) {
      context.addIssue({
        code: 'custom',
        path: ['lines', index, 'variantId'],
        message: 'ห้ามเพิ่มรูปแบบสินค้าเดิมซ้ำ',
      })
    }
    variantIds.add(line.variantId)
  })
})

export const reservationLookupSchema = z.object({
  reservationId: z.uuid('กรุณาระบุรหัสการจองเป็น UUID ที่ถูกต้อง'),
})

export type ReceiveLotValues = z.infer<typeof receiveLotSchema>
export type QuarantineValues = z.infer<typeof quarantineSchema>
export type WriteOffValues = z.infer<typeof writeOffSchema>
export type CountAdjustmentValues = z.infer<typeof countAdjustmentSchema>
export type ReservationValues = z.infer<typeof reservationSchema>

export function toReceiveInput(values: ReceiveLotValues, warehouseId: string, variantId: string): ReceiveInput {
  const input: ReceiveInput = {
    warehouseId,
    variantId,
    lotCode: values.lotCode,
    quantity: values.quantity,
    expiryDate: values.expiryDate,
  }
  if (values.receivedAt) input.receivedAt = bangkokInputToIso(values.receivedAt)
  if (values.quarantined) {
    input.quarantined = true
    input.quarantineReason = values.quarantineReason.trim()
  }
  return input
}

export function toQuarantineInput(values: QuarantineValues): QuarantineInput {
  return { reason: values.reason }
}

export function toWriteOffInput(values: WriteOffValues): WriteOffInput {
  const input: WriteOffInput = { quantity: values.quantity, reason: values.reason }
  if (values.note.trim()) input.note = values.note.trim()
  return input
}

export function toCountAdjustmentInput(values: CountAdjustmentValues): CountAdjustmentInput {
  return { countedQuantity: values.countedQuantity, reason: values.reason }
}

export function toReserveInput(values: ReservationValues, warehouseId: string): ReserveInput {
  const input: ReserveInput = {
    warehouseId,
    lines: values.lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
  }
  if (values.externalReference) input.externalReference = values.externalReference
  return input
}
