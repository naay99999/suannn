import { z } from 'zod'

const email = z.email('กรุณากรอกอีเมลให้ถูกต้อง').max(322, 'อีเมลยาวเกินไป')

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
})

export const signUpSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100, 'ชื่อยาวเกินไป'),
  email,
  password: z.string().min(12, 'รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร').max(256, 'รหัสผ่านยาวเกินไป'),
  confirmPassword: z.string(),
}).refine(value => value.password === value.confirmPassword, {
  path: ['confirmPassword'],
  message: 'รหัสผ่านไม่ตรงกัน',
})

export const forgotPasswordSchema = z.object({ email })
export const resetPasswordSchema = z.object({
  password: z.string().min(12, 'รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร').max(256, 'รหัสผ่านยาวเกินไป'),
  confirmPassword: z.string(),
}).refine(value => value.password === value.confirmPassword, {
  path: ['confirmPassword'],
  message: 'รหัสผ่านไม่ตรงกัน',
})

export type SignInValues = z.infer<typeof signInSchema>
export type SignUpValues = z.infer<typeof signUpSchema>
