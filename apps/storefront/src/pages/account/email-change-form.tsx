import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { authSessionQuery, clearCustomerQueries } from '@/lib/auth-session'
import { confirmEmailChange, requestEmailChange } from './account-api'
import { emailChangeCodeSchema, emailChangeRequestSchema } from './account-forms'

type RequestValues = z.infer<typeof emailChangeRequestSchema>
type CodeValues = z.infer<typeof emailChangeCodeSchema>

export function EmailChangeForm() {
  const [stage, setStage] = useState<'closed' | 'request' | 'confirm'>('closed')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const requestForm = useForm<RequestValues>({
    resolver: zodResolver(emailChangeRequestSchema), defaultValues: { newEmail: '', currentPassword: '' },
  })
  const codeForm = useForm<CodeValues>({
    resolver: zodResolver(emailChangeCodeSchema), defaultValues: { code: '' },
  })
  const requestMutation = useMutation({
    mutationFn: (values: RequestValues) => requestEmailChange(values.newEmail, values.currentPassword),
    onSuccess: () => setStage('confirm'),
  })
  const confirmMutation = useMutation({
    mutationFn: (values: CodeValues) => confirmEmailChange(values.code),
    onSuccess: () => {
      clearCustomerQueries(queryClient)
      queryClient.setQueryData(authSessionQuery.queryKey, null)
      navigate('/sign-in', { replace: true })
    },
  })

  if (stage === 'closed') return <Button type="button" variant="outline" onClick={() => setStage('request')}>เปลี่ยนอีเมล</Button>
  if (stage === 'confirm') return (
    <form noValidate onSubmit={codeForm.handleSubmit(values => confirmMutation.mutate(values))}>
      <FieldGroup className="gap-4">
        <p className="text-sm leading-7 text-muted-foreground">กรอกรหัส 8 หลักที่ส่งไปยังอีเมลใหม่ เมื่อยืนยันแล้วคุณจะต้องเข้าสู่ระบบอีกครั้ง</p>
        <Field data-invalid={Boolean(codeForm.formState.errors.code)}>
          <FieldLabel htmlFor="email-change-code">รหัสยืนยัน</FieldLabel>
          <Input id="email-change-code" inputMode="numeric" autoComplete="one-time-code" aria-invalid={Boolean(codeForm.formState.errors.code)} {...codeForm.register('code')} />
          <FieldError>{codeForm.formState.errors.code?.message}</FieldError>
        </Field>
        {confirmMutation.isError && <p role="alert" className="text-sm text-destructive">ยืนยันอีเมลไม่ได้ กรุณาตรวจรหัสแล้วลองใหม่</p>}
        <div className="flex gap-3"><Button type="submit" disabled={confirmMutation.isPending}>ยืนยันอีเมล</Button><Button type="button" variant="outline" onClick={() => setStage('closed')}>ยกเลิก</Button></div>
      </FieldGroup>
    </form>
  )

  return (
    <form noValidate onSubmit={requestForm.handleSubmit(values => requestMutation.mutate(values))}>
      <FieldGroup className="gap-4">
        <Field data-invalid={Boolean(requestForm.formState.errors.newEmail)}>
          <FieldLabel htmlFor="new-account-email">อีเมลใหม่</FieldLabel>
          <Input id="new-account-email" type="email" autoComplete="email" aria-invalid={Boolean(requestForm.formState.errors.newEmail)} {...requestForm.register('newEmail')} />
          <FieldError>{requestForm.formState.errors.newEmail?.message}</FieldError>
        </Field>
        <Field data-invalid={Boolean(requestForm.formState.errors.currentPassword)}>
          <FieldLabel htmlFor="email-change-password">รหัสผ่านปัจจุบัน</FieldLabel>
          <Input id="email-change-password" type="password" autoComplete="current-password" aria-invalid={Boolean(requestForm.formState.errors.currentPassword)} {...requestForm.register('currentPassword')} />
          <FieldError>{requestForm.formState.errors.currentPassword?.message}</FieldError>
        </Field>
        {requestMutation.isError && <p role="alert" className="text-sm text-destructive">ส่งคำขอไม่ได้ กรุณาตรวจข้อมูลแล้วลองใหม่</p>}
        <div className="flex gap-3"><Button type="submit" disabled={requestMutation.isPending}>ส่งรหัสยืนยัน</Button><Button type="button" variant="outline" onClick={() => setStage('closed')}>ยกเลิก</Button></div>
      </FieldGroup>
    </form>
  )
}
