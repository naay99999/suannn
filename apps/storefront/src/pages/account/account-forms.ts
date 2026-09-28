import { z } from 'zod'

const text = (max: number, message: string) => z.string().trim().min(1, message).max(max, 'ข้อความยาวเกินไป')

export const profileNameSchema = z.object({ name: text(100, 'กรุณากรอกชื่อ') })

export const addressSchema = z.object({
  label: text(60, 'กรุณาตั้งชื่อที่อยู่'),
  recipientName: text(100, 'กรุณากรอกชื่อผู้รับ'),
  phone: z.string().regex(/^[0-9]{9,10}$/, 'กรุณากรอกเบอร์โทรศัพท์ 9–10 หลัก'),
  addressLine1: text(200, 'กรุณากรอกที่อยู่'),
  addressLine2: z.union([z.string().trim().max(200), z.null()]),
  subdistrict: text(100, 'กรุณากรอกแขวงหรือตำบล'),
  district: text(100, 'กรุณากรอกเขตหรืออำเภอ'),
  province: text(100, 'กรุณากรอกจังหวัด'),
  postalCode: z.string().regex(/^[0-9]{5}$/, 'รหัสไปรษณีย์ต้องมี 5 หลัก'),
})

export const emailChangeRequestSchema = z.object({
  newEmail: z.email('กรุณากรอกอีเมลให้ถูกต้อง').max(320),
  currentPassword: z.string().min(1, 'กรุณากรอกรหัสผ่านปัจจุบัน'),
})

export const emailChangeCodeSchema = z.object({
  code: z.string().regex(/^[0-9]{8}$/, 'กรุณากรอกรหัส 8 หลัก'),
})

export type AddressFormValues = z.infer<typeof addressSchema>
