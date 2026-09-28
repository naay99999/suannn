import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { requestPasswordReset } from '@/lib/auth-client'
import { AuthPageFrame } from './auth-layout'
import { forgotPasswordSchema } from './auth-schemas'

type Values = z.infer<typeof forgotPasswordSchema>

export function Component() {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' },
  })

  async function submit(values: Values) {
    setPending(true)
    setError('')
    try {
      await requestPasswordReset(values.email, `${window.location.origin}/reset-password`)
      setSent(true)
    } catch {
      setError('ส่งคำขอไม่ได้ กรุณาลองใหม่')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthPageFrame title="ตั้งรหัสผ่านใหม่" description="กรอกอีเมลที่ใช้กับบัญชี แล้วตรวจข้อความในกล่องจดหมาย">
      <title>ลืมรหัสผ่าน | suannn</title>
      {sent ? <p role="status" className="max-w-md rounded-3xl bg-accent p-7 leading-7">หากอีเมลนี้มีบัญชีอยู่ เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้</p> : (
        <form noValidate onSubmit={handleSubmit(submit)} className="max-w-md">
          <FieldGroup className="gap-5">
            <Field data-invalid={Boolean(errors.email)}><FieldLabel htmlFor="recovery-email">อีเมล</FieldLabel><Input id="recovery-email" type="email" autoComplete="email" aria-invalid={Boolean(errors.email)} {...register('email')} /><FieldError>{errors.email?.message}</FieldError></Field>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="storefront" disabled={pending}>{pending ? 'กำลังส่ง...' : 'ส่งลิงก์ตั้งรหัสผ่าน'}</Button>
          </FieldGroup>
        </form>
      )}
      <p className="mt-6 text-sm"><Link className="font-semibold text-primary-ink underline underline-offset-4" to="/sign-in">กลับหน้าเข้าสู่ระบบ</Link></p>
    </AuthPageFrame>
  )
}
