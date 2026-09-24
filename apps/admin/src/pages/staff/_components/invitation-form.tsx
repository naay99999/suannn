import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { acceptInvitation, AuthRequestError } from '@/lib/auth-client'
import { refreshAuthSession } from '@/lib/auth-session'

const invitationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  password: z.string().min(12, 'Use at least 12 characters').max(256, 'Password is too long'),
})

type InvitationValues = z.infer<typeof invitationSchema>

export function InvitationForm({ token }: { token: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<InvitationValues>({
    resolver: zodResolver(invitationSchema),
    defaultValues: { name: '', password: '' },
  })

  async function submit(values: InvitationValues) {
    setSubmitError(null)
    setPending(true)
    try {
      await acceptInvitation({ token, name: values.name, password: values.password })
      await refreshAuthSession(queryClient)
      navigate('/staff/onboarding', { replace: true })
    } catch (error) {
      if (error instanceof AuthRequestError && error.status === 410) {
        setSubmitError('This invitation expired. Ask an administrator for a new invitation.')
      } else {
        setSubmitError(error instanceof AuthRequestError ? error.message : 'Could not accept the invitation. Try again.')
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <FieldGroup>
        {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="invite-name">Name</FieldLabel>
          <Input id="invite-name" autoComplete="name" aria-invalid={!!errors.name} {...register('name')} />
          <FieldError>{errors.name?.message}</FieldError>
        </Field>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="invite-password">New password</FieldLabel>
          <Input id="invite-password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register('password')} />
          <FieldError>{errors.password?.message}</FieldError>
        </Field>
        <Field><Button type="submit" disabled={pending}>{pending ? 'Accepting…' : 'Accept invitation'}</Button></Field>
      </FieldGroup>
    </form>
  )
}
