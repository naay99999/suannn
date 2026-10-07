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
    <AuthPageFrame title="ลืมรหัสผ่าน" description="กรอกอีเมลที่ใช้สมัครเพื่อรับลิงก์ตั้งรหัสผ่านใหม่">
      <title>ลืมรหัสผ่าน | suannn</title>
      {sent ? <div role="status"><h2 className="text-xl font-semibold">ตรวจอีเมลของคุณ</h2><p className="mt-3 leading-7 text-muted-foreground">หากอีเมลนี้มีบัญชีอยู่ เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้</p></div> : (
        <form noValidate onSubmit={handleSubmit(submit)} aria-busy={pending}>
          <FieldGroup className="gap-5">
            <Field data-invalid={Boolean(errors.email)}><FieldLabel htmlFor="recovery-email">อีเมล</FieldLabel><Input id="recovery-email" className="h-12 text-base md:text-base" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'recovery-email-error' : undefined} {...register('email')} /><FieldError id="recovery-email-error">{errors.email?.message}</FieldError></Field>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="storefront" className="w-full" disabled={pending}>{pending ? 'กำลังส่ง...' : 'ส่งลิงก์ตั้งรหัสผ่าน'}</Button>
          </FieldGroup>
        </form>
      )}
      <p className="mt-5 text-center text-sm"><Link className="inline-flex min-h-11 items-center font-semibold text-primary-ink underline underline-offset-4 transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" to="/sign-in">กลับหน้าเข้าสู่ระบบ</Link></p>
    </AuthPageFrame>
  )
}
