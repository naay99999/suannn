import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { AuthRequestError, signIn } from '@/lib/auth-client'
import { safeCustomerReturnPath, staffSignInUrl } from '@/lib/auth-navigation'
import { authSessionQuery, refreshAuthSession } from '@/lib/auth-session'
import { mergeCustomerCartOnce } from '@/lib/store-cart'
import { signInSchema, type SignInValues } from './auth-schemas'
import { AuthPageFrame } from './auth-layout'

export function Component() {
  const [searchParams] = useSearchParams()
  const returnTo = safeCustomerReturnPath(searchParams.get('returnTo'))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const session = useQuery(authSessionQuery)
  const [requestError, setRequestError] = useState('')
  const [staffFlow, setStaffFlow] = useState(false)
  const [pending, setPending] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })

  if (session.data?.user.accountType === 'customer') return <Navigate to={returnTo} replace />

  async function submit(values: SignInValues) {
    setPending(true)
    setRequestError('')
    setStaffFlow(false)
    try {
      const result = await signIn(values.email, values.password)
      if (result === 'challenge') {
        setRequestError('บัญชีนี้ต้องยืนยันตัวตนสำหรับผู้ดูแลระบบ กรุณาเข้าสู่ระบบผ่านหน้าผู้ดูแล')
        setStaffFlow(true)
        return
      }
      const next = await refreshAuthSession(queryClient)
      if (next?.user.accountType !== 'customer') {
        setRequestError('บัญชีนี้ไม่ใช่บัญชีลูกค้า กรุณาเข้าสู่ระบบผ่านหน้าผู้ดูแล')
        setStaffFlow(true)
        return
      }
      void mergeCustomerCartOnce(next.session.id, queryClient).catch(() => undefined)
      navigate(returnTo, { replace: true })
    } catch (error) {
      setRequestError(error instanceof AuthRequestError ? error.message : 'เข้าสู่ระบบไม่ได้ กรุณาลองใหม่')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthPageFrame title="เข้าสู่ระบบ" description="ดูคำสั่งซื้อและจัดการบัญชีของคุณ">
      <title>เข้าสู่ระบบ | suannn</title>
      <form noValidate onSubmit={handleSubmit(submit)} aria-busy={pending}>
        <FieldGroup className="gap-5">
          <Field data-invalid={Boolean(errors.email)}>
            <FieldLabel htmlFor="sign-in-email">อีเมล</FieldLabel>
            <Input id="sign-in-email" className="h-12 text-base md:text-base" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'sign-in-email-error' : undefined} {...register('email')} />
            <FieldError id="sign-in-email-error">{errors.email?.message}</FieldError>
          </Field>
          <Field data-invalid={Boolean(errors.password)}>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <FieldLabel htmlFor="sign-in-password">รหัสผ่าน</FieldLabel>
              <Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary-ink underline underline-offset-4 transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" to="/forgot-password">ลืมรหัสผ่าน?</Link>
            </div>
            <Input id="sign-in-password" className="h-12 text-base md:text-base" type="password" autoComplete="current-password" aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'sign-in-password-error' : undefined} {...register('password')} />
            <FieldError id="sign-in-password-error">{errors.password?.message}</FieldError>
          </Field>
          {requestError && <p role="alert" className="text-sm text-destructive">{requestError}</p>}
          {staffFlow && <a className="text-sm font-semibold text-primary-ink underline underline-offset-4" href={staffSignInUrl(import.meta.env.VITE_ADMIN_URL || 'http://localhost:5184')}>ไปหน้าเข้าสู่ระบบผู้ดูแล</a>}
          <Button type="submit" size="storefront" className="w-full" disabled={pending}>{pending ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</Button>
        </FieldGroup>
      </form>
      <p className="mt-5 flex flex-wrap items-center justify-center gap-x-2 text-sm text-muted-foreground">ยังไม่มีบัญชี? <Link className="inline-flex min-h-11 items-center font-semibold text-primary-ink underline underline-offset-4 transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" to="/sign-up">สมัครสมาชิก</Link></p>
    </AuthPageFrame>
  )
}
