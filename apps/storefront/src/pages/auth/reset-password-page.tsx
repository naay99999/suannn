import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link, useParams, useSearchParams } from 'react-router'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { resetPassword } from '@/lib/auth-client'
import { AuthPageFrame } from './auth-layout'
import { resetPasswordSchema } from './auth-schemas'

type Values = z.infer<typeof resetPasswordSchema>

export function Component() {
  const [searchParams] = useSearchParams()
  const { token: pathToken } = useParams()
  const token = searchParams.get('token') ?? pathToken
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(resetPasswordSchema), defaultValues: { password: '', confirmPassword: '' },
  })

  async function submit(values: Values) {
    if (!token) return
    setPending(true)
    setError('')
    try {
      await resetPassword(token, values.password)
      setCompleted(true)
    } catch {
      setError('ลิงก์อาจหมดอายุหรือใช้ไม่ได้ กรุณาขอลิงก์ใหม่')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthPageFrame title="ตั้งรหัสผ่านใหม่" description="เลือกรหัสผ่านใหม่ที่มีอย่างน้อย 12 ตัวอักษร">
      <title>ตั้งรหัสผ่านใหม่ | suannn</title>
      {!token ? <p role="alert" className="text-destructive">ไม่พบรหัสสำหรับตั้งรหัสผ่านใหม่</p> : completed ? (
        <div role="status"><p className="leading-7">ตั้งรหัสผ่านใหม่แล้ว</p><Button render={<Link to="/sign-in" />} nativeButton={false} size="storefront" className="mt-5 w-full">เข้าสู่ระบบ</Button></div>
      ) : (
        <form noValidate onSubmit={handleSubmit(submit)} aria-busy={pending}>
          <FieldGroup className="gap-5">
            <Field data-invalid={Boolean(errors.password)}><FieldLabel htmlFor="reset-password">รหัสผ่านใหม่</FieldLabel><Input id="reset-password" className="h-12 text-base md:text-base" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'reset-password-error' : undefined} {...register('password')} /><FieldError id="reset-password-error">{errors.password?.message}</FieldError></Field>
            <Field data-invalid={Boolean(errors.confirmPassword)}><FieldLabel htmlFor="reset-confirm">ยืนยันรหัสผ่านใหม่</FieldLabel><Input id="reset-confirm" className="h-12 text-base md:text-base" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={errors.confirmPassword ? 'reset-confirm-error' : undefined} {...register('confirmPassword')} /><FieldError id="reset-confirm-error">{errors.confirmPassword?.message}</FieldError></Field>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="storefront" className="w-full" disabled={pending}>{pending ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}</Button>
          </FieldGroup>
        </form>
      )}
      {!completed && <p className="mt-5 text-center text-sm"><Link className="inline-flex min-h-11 items-center font-semibold text-primary-ink underline underline-offset-4 transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" to="/forgot-password">ขอลิงก์ใหม่</Link></p>}
    </AuthPageFrame>
  )
}
