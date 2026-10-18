import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { authSessionQuery, clearCustomerQueries } from '@/lib/auth-session'
import { confirmEmailChange, requestEmailChange } from './account-api'
import { emailChangeCodeSchema, emailChangeRequestSchema } from './account-forms'
import { emailChangeConfirmFailure, emailChangeRequestFailure } from './customer-security'
import { ButtonSpinner } from '@/components/loading/button-spinner'
import { textLink } from './account-styles'

type RequestValues = z.infer<typeof emailChangeRequestSchema>
type CodeValues = z.input<typeof emailChangeCodeSchema>

// Rendered only while the email row is open. The parent keeps `pendingEmail` across closes so
// reopening resumes at the code step while the code is still valid.
export function EmailChangeForm({ currentEmail, pendingEmail, onPendingEmailChange, onClose }: {
  currentEmail: string
  pendingEmail: string
  onPendingEmailChange: (email: string) => void
  onClose: () => void
}) {
  const [stage, setStage] = useState<'request' | 'confirm'>(pendingEmail ? 'confirm' : 'request')
  const [requestError, setRequestError] = useState('')
  const [confirmError, setConfirmError] = useState<{ expired: boolean; message: string } | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const requestForm = useForm<RequestValues>({
    resolver: zodResolver(emailChangeRequestSchema), defaultValues: { newEmail: '', currentPassword: '' },
  })
  const codeForm = useForm<CodeValues, unknown, z.output<typeof emailChangeCodeSchema>>({
    resolver: zodResolver(emailChangeCodeSchema), defaultValues: { code: '' },
  })
  const requestMutation = useMutation({
    mutationFn: (values: RequestValues) => requestEmailChange(values.newEmail, values.currentPassword),
    onMutate: () => setRequestError(''),
    onSuccess: (_result, values) => {
      onPendingEmailChange(values.newEmail)
      requestForm.resetField('currentPassword')
      codeForm.reset()
      setConfirmError(null)
      setStage('confirm')
    },
    onError: error => {
      const failure = emailChangeRequestFailure(error)
      if (failure.field) requestForm.setError(failure.field, { message: failure.message }, { shouldFocus: true })
      else setRequestError(failure.message)
    },
  })
  const confirmMutation = useMutation({
    mutationFn: (values: { code: string }) => confirmEmailChange(values.code),
    onMutate: () => setConfirmError(null),
    onSuccess: () => {
      clearCustomerQueries(queryClient)
      queryClient.setQueryData(authSessionQuery.queryKey, null)
      navigate('/sign-in?emailChanged=1', { replace: true })
    },
    onError: error => setConfirmError(emailChangeConfirmFailure(error)),
  })

  // Each step starts with focus in its first field.
  useEffect(() => {
    if (stage === 'request') requestForm.setFocus(pendingEmail ? 'currentPassword' : 'newEmail')
    if (stage === 'confirm') codeForm.setFocus('code')
  }, [stage, pendingEmail, requestForm, codeForm])

  function requestNewCode() {
    requestForm.setValue('newEmail', pendingEmail)
    onPendingEmailChange('')
    setStage('request')
  }

  const codeError = codeForm.formState.errors.code
  if (stage === 'confirm') return (
    <form noValidate aria-label="ยืนยันอีเมลใหม่" onSubmit={codeForm.handleSubmit(values => confirmMutation.mutate(values))} className="max-w-md">
      <FieldGroup className="gap-4">
        <p className="text-sm leading-7">
          เราส่งรหัส 8 หลักไปที่ <strong className="break-all">{pendingEmail}</strong> แล้ว
          <span className="block text-muted-foreground">เมื่อยืนยันแล้วจะออกจากระบบทุกอุปกรณ์ และต้องเข้าสู่ระบบใหม่ด้วยอีเมลนี้</span>
        </p>
        <Field data-invalid={Boolean(codeError)}>
          <FieldLabel htmlFor="email-change-code">รหัสยืนยัน</FieldLabel>
          <Input id="email-change-code" inputMode="numeric" autoComplete="one-time-code" maxLength={11} className="max-w-48 font-mono tracking-widest tabular-nums" aria-invalid={Boolean(codeError)} aria-describedby={codeError ? 'email-change-code-error' : undefined} {...codeForm.register('code')} />
          <FieldError id="email-change-code-error">{codeError?.message}</FieldError>
        </Field>
        {confirmError && <p role="alert" className="text-sm text-destructive">{confirmError.message}</p>}
        <div className="flex flex-wrap gap-3">
          {confirmError?.expired
            ? <Button type="button" onClick={requestNewCode}>ขอรหัสใหม่</Button>
            : <Button type="submit" disabled={confirmMutation.isPending}><ButtonSpinner show={confirmMutation.isPending} />{confirmMutation.isPending ? 'กำลังยืนยัน...' : 'ยืนยันอีเมล'}</Button>}
          <Button type="button" variant="outline" disabled={confirmMutation.isPending} onClick={onClose}>ไว้ทีหลัง</Button>
        </div>
        {!confirmError?.expired && <p className="text-sm text-muted-foreground">
          ไม่ได้รับรหัส? ตรวจโฟลเดอร์สแปม หรือ{' '}
          <button type="button" onClick={requestNewCode} className={textLink}>ส่งรหัสใหม่ / เปลี่ยนอีเมล</button>
        </p>}
      </FieldGroup>
    </form>
  )

  const { errors } = requestForm.formState
  return (
    <form noValidate aria-label="เปลี่ยนอีเมล" onSubmit={requestForm.handleSubmit(values => requestMutation.mutate(values))} className="max-w-md">
      <FieldGroup className="gap-4">
        <Field data-invalid={Boolean(errors.newEmail)}>
          <FieldLabel htmlFor="new-account-email">อีเมลใหม่</FieldLabel>
          <Input id="new-account-email" type="email" autoComplete="email" aria-invalid={Boolean(errors.newEmail)} aria-describedby={errors.newEmail ? 'new-account-email-error' : 'new-account-email-hint'} {...requestForm.register('newEmail')} />
          {errors.newEmail ? <FieldError id="new-account-email-error">{errors.newEmail.message}</FieldError> : <FieldDescription id="new-account-email-hint">ใช้แทน {currentEmail} เราจะส่งรหัสยืนยันไปที่อีเมลใหม่</FieldDescription>}
        </Field>
        <Field data-invalid={Boolean(errors.currentPassword)}>
          <FieldLabel htmlFor="email-change-password">รหัสผ่านปัจจุบัน</FieldLabel>
          <Input id="email-change-password" type="password" autoComplete="current-password" aria-invalid={Boolean(errors.currentPassword)} aria-describedby={errors.currentPassword ? 'email-change-password-error' : undefined} {...requestForm.register('currentPassword')} />
          <FieldError id="email-change-password-error">{errors.currentPassword?.message}</FieldError>
        </Field>
        {requestError && <p role="alert" className="text-sm text-destructive">{requestError}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={requestMutation.isPending}><ButtonSpinner show={requestMutation.isPending} />{requestMutation.isPending ? 'กำลังส่ง...' : 'ส่งรหัสยืนยัน'}</Button>
          <Button type="button" variant="outline" disabled={requestMutation.isPending} onClick={onClose}>ยกเลิก</Button>
        </div>
      </FieldGroup>
    </form>
  )
}
