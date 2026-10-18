import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { api } from '@/lib/api'
import { signIn } from '@/lib/auth-client'
import { authSessionQuery, refreshAuthSession } from '@/lib/auth-session'
import { mergeCustomerCartOnce } from '@/lib/store-cart'
import { AuthPageFrame } from './auth-layout'
import { registrationResultContent, type RegistrationResult } from './auth-result'
import { signUpSchema, type SignUpValues } from './auth-schemas'
import { ButtonSpinner } from '@/components/loading/button-spinner'

export function Component() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const session = useQuery(authSessionQuery)
  const [result, setResult] = useState<RegistrationResult | null>(null)
  const [requestError, setRequestError] = useState('')
  const [pending, setPending] = useState(false)
  const { register, handleSubmit, formState: { errors, touchedFields } } = useForm<SignUpValues>({
    mode: 'onTouched',
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  })

  if (session.data?.user.accountType === 'customer') return <Navigate to="/account" replace />

  // Uses the ordinary sign-in endpoint, so it reveals nothing beyond what the sign-in form already does.
  async function signInAfterRegistration(email: string, password: string) {
    try {
      if (await signIn(email, password) !== 'session') return false
      const next = await refreshAuthSession(queryClient)
      if (next?.user.accountType !== 'customer') return false
      void mergeCustomerCartOnce(next.session.id, queryClient).catch(() => undefined)
      navigate('/account', { replace: true })
      return true
    } catch {
      return false
    }
  }

  async function submit(values: SignUpValues) {
    setPending(true)
    setRequestError('')
    try {
      const { data, error } = await api.auth['sign-up'].post({
        name: values.name, email: values.email, password: values.password,
      })
      if (error || !data) throw new Error('สมัครสมาชิกไม่ได้ กรุณาลองใหม่')
      if (data.next === 'sign-in' && await signInAfterRegistration(values.email, values.password)) return
      setResult(data)
    } catch {
      setRequestError('สมัครสมาชิกไม่ได้ กรุณาลองใหม่')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthPageFrame title="สมัครสมาชิก" description="สร้างบัญชีเพื่อดูคำสั่งซื้อและจัดการข้อมูลของคุณ">
      <title>สมัครสมาชิก | suannn</title>
      {result ? (
        <div role="status">
          <h2 className="text-xl font-semibold">{registrationResultContent(result).title}</h2>
          <p className="mt-3 leading-7 text-muted-foreground">{registrationResultContent(result).message}</p>
          <Button render={<Link to="/sign-in" />} nativeButton={false} size="storefront" className="mt-6 w-full">ไปหน้าเข้าสู่ระบบ</Button>
        </div>
      ) : (
        <form noValidate onSubmit={handleSubmit(submit)} aria-busy={pending}>
          <FieldGroup className="gap-5">
            <Field data-invalid={Boolean(errors.name)}><FieldLabel htmlFor="sign-up-name">ชื่อที่แสดง</FieldLabel><Input id="sign-up-name" className="text-base md:text-base" autoComplete="name" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'sign-up-name-error' : undefined} {...register('name')} /><FieldError id="sign-up-name-error">{errors.name?.message}</FieldError></Field>
            <Field data-invalid={Boolean(errors.email)}><FieldLabel htmlFor="sign-up-email">อีเมล</FieldLabel><Input id="sign-up-email" className="text-base md:text-base" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'sign-up-email-error' : undefined} {...register('email')} /><FieldError id="sign-up-email-error">{errors.email?.message}</FieldError></Field>
            <Field data-invalid={Boolean(errors.password)}><FieldLabel htmlFor="sign-up-password">รหัสผ่าน</FieldLabel><Input id="sign-up-password" className="text-base md:text-base" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'sign-up-password-error' : undefined} {...register('password', { deps: touchedFields.confirmPassword ? ['confirmPassword'] : [] })} /><FieldError id="sign-up-password-error">{errors.password?.message}</FieldError></Field>
            <Field data-invalid={Boolean(errors.confirmPassword)}><FieldLabel htmlFor="sign-up-confirm">ยืนยันรหัสผ่าน</FieldLabel><Input id="sign-up-confirm" className="text-base md:text-base" type="password" autoComplete="new-password" aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={errors.confirmPassword ? 'sign-up-confirm-error' : undefined} {...register('confirmPassword')} /><FieldError id="sign-up-confirm-error">{errors.confirmPassword?.message}</FieldError></Field>
            {requestError && <p role="alert" className="text-sm text-destructive">{requestError}</p>}
            <Button type="submit" size="storefront" className="w-full" disabled={pending}><ButtonSpinner show={pending} />{pending ? 'กำลังส่งข้อมูล...' : 'สมัครสมาชิก'}</Button>
          </FieldGroup>
        </form>
      )}
      <p className="mt-5 flex flex-wrap items-center justify-center gap-x-2 text-sm text-muted-foreground">มีบัญชีอยู่แล้ว? <Link className="inline-flex min-h-11 items-center font-semibold text-primary-ink underline underline-offset-4 transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" to="/sign-in">เข้าสู่ระบบ</Link></p>
    </AuthPageFrame>
  )
}
