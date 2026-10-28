import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AuthRequestError, resetPassword } from '@/lib/auth-client'

const EXPIRED_MESSAGE = 'ลิงก์หมดอายุหรือใช้ไปแล้ว กรุณาขอลิงก์ใหม่จากผู้ดูแล'
const SUCCESS_NOTICE = 'ตั้งรหัสผ่านใหม่แล้ว กรุณาเข้าสู่ระบบ'

const resetSchema = z.object({
  password: z.string().min(12, 'Password must be at least 12 characters'),
  confirm: z.string(),
}).refine((values) => values.password === values.confirm, {
  path: ['confirm'],
  message: 'Passwords do not match',
})

type ResetValues = z.infer<typeof resetSchema>

function ResetForm({ token }: { token: string }) {
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirm: '' },
  })

  async function submit(values: ResetValues) {
    setSubmitError(null)
    setPending(true)
    try {
      await resetPassword(token, values.password)
      navigate('/login', { replace: true, state: { notice: SUCCESS_NOTICE } })
    } catch (error) {
      setSubmitError(
        error instanceof AuthRequestError && error.code === 'INVALID_TOKEN'
          ? EXPIRED_MESSAGE
          : error instanceof AuthRequestError ? error.message : 'Could not set the password. Try again.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <FieldGroup>
        {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <Input id="new-password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register('password')} />
          <FieldError>{errors.password?.message}</FieldError>
        </Field>
        <Field data-invalid={!!errors.confirm}>
          <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
          <Input id="confirm-password" type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...register('confirm')} />
          <FieldError>{errors.confirm?.message}</FieldError>
        </Field>
        <Field>
          <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Set new password'}</Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

export function Component() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const failed = !token || params.has('error')

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-xl font-bold">Suannn</h1>
          {!failed && <p className="text-sm text-muted-foreground">Choose a new password (at least 12 characters).</p>}
        </div>
        {failed ? (
          <div className="flex flex-col gap-4 text-center">
            <p role="alert" className="text-sm text-destructive">{EXPIRED_MESSAGE}</p>
            <Button variant="outline" render={<Link to="/login" />}>Back to sign in</Button>
          </div>
        ) : <ResetForm token={token} />}
      </div>
    </main>
  )
}
