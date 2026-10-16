import { expect, test } from 'bun:test'
import { forgotPasswordSchema, resetPasswordSchema, signInSchema, signUpSchema } from '../src/pages/auth/auth-schemas'
import { registrationSuccessMessage } from '../src/pages/auth/auth-result'

const valid = {
  name: '  มะลิ ใจดี  ', email: 'mali@example.com',
  password: 'strongpassword123', confirmPassword: 'strongpassword123',
}

test('trims a valid name and rejects name length outside API bounds', () => {
  expect(signUpSchema.parse(valid).name).toBe('มะลิ ใจดี')
  expect(signUpSchema.safeParse({ ...valid, name: ' ' }).success).toBe(false)
  expect(signUpSchema.safeParse({ ...valid, name: 'a'.repeat(101) }).success).toBe(false)
})

test('rejects malformed or oversized email', () => {
  expect(signUpSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
  expect(signUpSchema.safeParse({ ...valid, email: `${'a'.repeat(320)}@example.com` }).success).toBe(false)
  expect(signInSchema.safeParse({ email: 'not-an-email', password: 'password' }).success).toBe(false)
})

test('enforces API password bounds and confirmation', () => {
  expect(signUpSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' }).success).toBe(false)
  expect(signUpSchema.safeParse({ ...valid, password: 'a'.repeat(257), confirmPassword: 'a'.repeat(257) }).success).toBe(false)
  const mismatch = signUpSchema.safeParse({ ...valid, confirmPassword: 'anotherpassword123' })
  expect(mismatch.success).toBe(false)
  if (!mismatch.success) expect(mismatch.error.issues[0]?.path).toEqual(['confirmPassword'])
})

test('uses one registration result independent of whether an address exists', () => {
  const accepted = { accepted: true, next: 'sign-in' } as const
  expect(registrationSuccessMessage(accepted)).toContain('หากอีเมลนี้ใช้ลงทะเบียนได้')
  expect(registrationSuccessMessage(accepted)).not.toMatch(/สร้างบัญชีแล้ว|ลงทะเบียนสำเร็จ/)
})

test('distinguishes missing confirmation from a password mismatch', () => {
  for (const schema of [signUpSchema, resetPasswordSchema]) {
    const result = schema.safeParse({ ...valid, confirmPassword: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.find(issue => issue.path[0] === 'confirmPassword')?.message)
        .toBe('กรุณายืนยันรหัสผ่าน')
    }
  }
})

test('normalizes surrounding email whitespace on every email form', () => {
  for (const schema of [signInSchema, signUpSchema, forgotPasswordSchema]) {
    expect(schema.parse({ ...valid, email: '  mali@example.com  ' }).email).toBe('mali@example.com')
  }
})

test('reset password enforces length bounds and matching confirmation', () => {
  expect(resetPasswordSchema.safeParse(valid).success).toBe(true)
  for (const password of ['', 'short', 'a'.repeat(257)]) {
    expect(resetPasswordSchema.safeParse({ password, confirmPassword: password }).success).toBe(false)
  }
  expect(resetPasswordSchema.safeParse({ ...valid, confirmPassword: 'differentpassword' }).success).toBe(false)
})
