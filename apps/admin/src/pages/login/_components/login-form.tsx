import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { cn } from '@workspace/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ComponentProps } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AuthRequestError, signIn } from '@/lib/auth-client'
import { refreshAuthSession } from '@/lib/auth-session'
import { safeReturnTo } from '@/lib/return-to'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginFormValues = z.infer<typeof loginSchema>

export function LoginForm({ className, ...props }: ComponentProps<'div'>) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const routeState = location.state as { from?: string; reason?: string } | null
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function submit(values: LoginFormValues) {
    setSubmitError(null)
    setPending(true)
    try {
      const result = await signIn(values.email, values.password)
      if (result === 'challenge') {
        navigate('/login/mfa', { replace: true, state: { challenge: true, from: safeReturnTo(routeState?.from) } })
        return
      }

      const state = await refreshAuthSession(queryClient)
      if (state === 'active') {
        navigate(safeReturnTo(routeState?.from), { replace: true })
      } else if (state === 'onboarding') {
        navigate('/staff/onboarding', { replace: true })
      } else {
        setSubmitError('Use a staff account to sign in.')
      }
    } catch (error) {
      setSubmitError(error instanceof AuthRequestError ? error.message : 'Could not sign in. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-xl font-bold">Suannn</h1>
        <p className="text-sm text-muted-foreground">Enter your email and password to sign in.</p>
      </div>
      <form onSubmit={handleSubmit(submit)}>
        <FieldGroup>
          {(submitError || routeState?.reason) && <p role="alert" className="text-sm text-destructive">{submitError || routeState?.reason}</p>}
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...register('email')}
            />
            <FieldError>{errors.email?.message}</FieldError>
          </Field>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            <FieldError>{errors.password?.message}</FieldError>
          </Field>
          <Field>
            <Button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Login'}</Button>
          </Field>
        </FieldGroup>
      </form>
    </div>
  )
}
