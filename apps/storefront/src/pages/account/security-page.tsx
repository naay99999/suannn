import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { toast } from '@workspace/ui/components/toast'
import { cn } from '@workspace/ui/lib/utils'
import { changePassword, listSessions, revokeOtherSessions, revokeSession } from '@/lib/auth-client'
import { authSessionQuery, accountQueryPrefix } from '@/lib/auth-session'
import { AccountPageHeading } from './account-ui'
import { accountSurface, accountSurfacePadding, standaloneTextLink, settingListClassName } from './account-styles'
import { DeleteAccountCard } from './delete-account-card'
import { SettingRow } from './setting-row'
import { useEditorToggle } from './use-editor-toggle'
import {
  describeUserAgent,
  expireSecuritySession,
  parseCustomerSessions,
  passwordChangeFailure,
  performRevokeSession,
  securityFailureMessage,
  sortSessions,
  type CustomerSessionRow,
} from './customer-security'
import { ButtonSpinner } from '@/components/loading/button-spinner'
import { PasswordInput } from '@/components/password-input'

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'กรุณากรอกรหัสผ่านปัจจุบัน'),
  newPassword: z.string().min(12, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 12 ตัวอักษร').max(256, 'รหัสผ่านใหม่ยาวเกินไป'),
  confirmPassword: z.string(),
}).refine(values => values.newPassword === values.confirmPassword, {
  path: ['confirmPassword'], message: 'รหัสผ่านใหม่ไม่ตรงกัน',
}).refine(values => !values.currentPassword || values.newPassword !== values.currentPassword, {
  path: ['newPassword'], message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน',
})
type PasswordValues = z.infer<typeof passwordSchema>

const sessionsKey = (userId: string) => [...accountQueryPrefix(userId), 'sessions'] as const

export function Component() {
  const location = useLocation()
  const session = useQuery(authSessionQuery).data
  const userId = session?.user.id ?? ''

  // Verification emails sent before email moved to the profile page still point here.
  if (new URLSearchParams(location.search).has('error')) return <Navigate to={{ pathname: '/account/profile', search: location.search }} replace />

  return (
    <>
      <title>ความปลอดภัยบัญชี | suannn</title>
      <AccountPageHeading title="ความปลอดภัย" description="จัดการรหัสผ่านและอุปกรณ์ที่เข้าสู่ระบบ ส่วนอีเมลอยู่ในหน้าข้อมูลส่วนตัว" />
      <div className="flex flex-col gap-10">
        <div className={settingListClassName}><PasswordRow userId={userId} /></div>
        <SessionsSection userId={userId} currentSessionId={session?.session.id} />
      </div>
      <section aria-labelledby="danger-zone-title" className="mt-12 border-t pt-8">
        <h3 id="danger-zone-title" className="mb-4 text-sm font-medium text-destructive">พื้นที่อันตราย</h3>
        <DeleteAccountCard />
      </section>
    </>
  )
}

function PasswordRow({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const { editing, trigger, open, close } = useEditorToggle()
  const [signOutOthers, setSignOutOthers] = useState(true)
  const [error, setError] = useState('')
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })
  const mutation = useMutation({
    mutationFn: (values: PasswordValues) => changePassword(values.currentPassword, values.newPassword, signOutOthers),
    onMutate: () => setError(''),
    onSuccess: () => {
      form.reset()
      close()
      if (signOutOthers) void queryClient.invalidateQueries({ queryKey: sessionsKey(userId) })
      toast.add({ title: 'เปลี่ยนรหัสผ่านแล้ว', description: signOutOthers ? 'ออกจากระบบในอุปกรณ์อื่นทั้งหมดแล้ว' : undefined, type: 'success' })
    },
    onError: cause => {
      if (expireSecuritySession(queryClient, cause)) return
      const failure = passwordChangeFailure(cause)
      if (failure.field) form.setError(failure.field, { message: failure.message }, { shouldFocus: true })
      else setError(failure.message)
    },
  })
  const { errors } = form.formState
  useEffect(() => { if (editing) form.setFocus('currentPassword') }, [editing, form])

  function cancel() {
    form.reset()
    setError('')
    mutation.reset()
    close()
  }

  return (
    <SettingRow id="security-password" title="รหัสผ่าน" description="ถ้าสงสัยว่ามีคนรู้รหัสผ่าน ให้เปลี่ยนและออกจากระบบในอุปกรณ์อื่นทันที" editing={editing}
      action={<Button ref={trigger} type="button" variant="outline" onClick={open}>เปลี่ยนรหัสผ่าน</Button>}>
      {editing
        ? <form noValidate aria-label="เปลี่ยนรหัสผ่าน" onSubmit={form.handleSubmit(values => mutation.mutate(values))} className="max-w-md">
          <FieldGroup className="gap-5">
            <Field data-invalid={Boolean(errors.currentPassword)}>
              <FieldLabel htmlFor="current-password">รหัสผ่านปัจจุบัน</FieldLabel>
              <PasswordInput id="current-password" autoComplete="current-password" aria-invalid={Boolean(errors.currentPassword)} aria-describedby={errors.currentPassword ? 'current-password-error' : undefined} {...form.register('currentPassword')} />
              <FieldError id="current-password-error">{errors.currentPassword?.message}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.newPassword)}>
              <FieldLabel htmlFor="new-password">รหัสผ่านใหม่</FieldLabel>
              <PasswordInput id="new-password" autoComplete="new-password" aria-invalid={Boolean(errors.newPassword)} aria-describedby={errors.newPassword ? 'new-password-error' : 'new-password-hint'} {...form.register('newPassword', { deps: form.formState.touchedFields.confirmPassword ? ['confirmPassword'] : [] })} />
              {errors.newPassword ? <FieldError id="new-password-error">{errors.newPassword.message}</FieldError> : <FieldDescription id="new-password-hint">อย่างน้อย 12 ตัวอักษร ใช้วลีที่จำง่ายแต่เดายากได้</FieldDescription>}
            </Field>
            <Field data-invalid={Boolean(errors.confirmPassword)}>
              <FieldLabel htmlFor="confirm-new-password">ยืนยันรหัสผ่านใหม่</FieldLabel>
              <PasswordInput id="confirm-new-password" autoComplete="new-password" aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={errors.confirmPassword ? 'confirm-new-password-error' : undefined} {...form.register('confirmPassword')} />
              <FieldError id="confirm-new-password-error">{errors.confirmPassword?.message}</FieldError>
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="sign-out-others" checked={signOutOthers} onCheckedChange={setSignOutOthers} />
              <FieldLabel htmlFor="sign-out-others" className="font-normal">ออกจากระบบในอุปกรณ์อื่นทั้งหมด</FieldLabel>
            </Field>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={mutation.isPending}><ButtonSpinner show={mutation.isPending} />{mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}</Button>
              <Button type="button" variant="outline" disabled={mutation.isPending} onClick={cancel}>ยกเลิก</Button>
            </div>
            <Link to="/forgot-password" className={cn(standaloneTextLink, 'self-start text-sm')}>ลืมรหัสผ่านปัจจุบัน?</Link>
          </FieldGroup>
        </form>
        : <p className="py-1 font-medium"><span aria-hidden="true" className="tracking-widest">••••••••</span><span className="sr-only">ตั้งรหัสผ่านไว้แล้ว</span></p>}
    </SettingRow>
  )
}

function SessionsSection({ userId, currentSessionId }: { userId: string; currentSessionId?: string }) {
  const queryClient = useQueryClient()
  const sessions = useQuery({
    queryKey: sessionsKey(userId),
    queryFn: async () => parseCustomerSessions(await listSessions()),
    enabled: Boolean(userId), retry: false,
  })
  useEffect(() => {
    if (sessions.isError) expireSecuritySession(queryClient, sessions.error)
  }, [queryClient, sessions.error, sessions.isError])
  const revokeOthers = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionsKey(userId) })
      toast.add({ title: 'ออกจากระบบในอุปกรณ์อื่นทั้งหมดแล้ว', type: 'success' })
    },
    onError: cause => { expireSecuritySession(queryClient, cause) },
  })
  const rows = sortSessions(sessions.data ?? [], currentSessionId)
  const hasOthers = rows.some(row => row.id !== currentSessionId)

  return (
    <section aria-labelledby="sessions-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 id="sessions-title" className="text-lg font-semibold">อุปกรณ์ที่เข้าสู่ระบบ</h3>
          <p className="mt-1 text-sm leading-6 text-pretty text-muted-foreground">ถ้าเห็นอุปกรณ์ที่ไม่รู้จัก ให้ออกจากระบบอุปกรณ์นั้นแล้วเปลี่ยนรหัสผ่าน</p>
        </div>
        {hasOthers && <Button type="button" variant="outline" disabled={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}><ButtonSpinner show={revokeOthers.isPending} />{revokeOthers.isPending ? 'กำลังออกจากระบบ...' : 'ออกจากระบบในอุปกรณ์อื่นทั้งหมด'}</Button>}
      </div>
      {revokeOthers.isError && <p role="alert" className="text-sm text-destructive">{securityFailureMessage(revokeOthers.error)}</p>}
      {sessions.isPending ? <div role="status" aria-label="กำลังโหลดอุปกรณ์" className={settingListClassName}>
        {[0, 1].map(row => <div key={row} className="flex items-center justify-between gap-4 px-5 py-4 md:px-6"><div className="flex flex-col gap-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56 max-w-full" /></div><Skeleton className="h-(--control-h) w-28 rounded-control" /></div>)}
      </div> : sessions.isError ? <div role="alert" className={cn(accountSurface, accountSurfacePadding, 'flex flex-wrap items-center justify-between gap-3')}>
        <p className="text-sm">โหลดรายการอุปกรณ์ไม่ได้</p>
        <Button type="button" variant="outline" onClick={() => void sessions.refetch()}>ลองอีกครั้ง</Button>
      </div> : rows.length ? <ul aria-labelledby="sessions-title" className={settingListClassName}>
        {rows.map(row => <SessionRow key={row.id} row={row} current={row.id === currentSessionId} userId={userId} />)}
      </ul> : <p className="rounded-surface border border-dashed px-5 py-4 text-sm text-muted-foreground">ไม่พบรายการอุปกรณ์</p>}
    </section>
  )
}

const activityFormat = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function SessionRow({ row, current, userId }: { row: CustomerSessionRow; current: boolean; userId: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const device = describeUserAgent(row.userAgent)
  const mutation = useMutation({
    mutationFn: () => performRevokeSession(queryClient, row.token, current, revokeSession),
    onSuccess: async wasCurrent => {
      if (wasCurrent) { navigate('/sign-in', { replace: true }); return }
      await queryClient.invalidateQueries({ queryKey: sessionsKey(userId) })
      toast.add({ title: `ออกจากระบบ ${device} แล้ว`, type: 'success' })
    },
    onError: cause => { expireSecuritySession(queryClient, cause) },
  })
  const activity = row.updatedAt || row.createdAt

  return (
    <li className={cn('px-5 py-4 md:px-6', current && 'bg-accent/40')}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium break-words" title={row.userAgent ?? undefined}>{device}</p>
            {current && <Badge variant="secondary">อุปกรณ์นี้</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {current ? 'กำลังใช้งาน' : activity ? `ใช้งานล่าสุด ${activityFormat.format(new Date(activity))}` : 'ไม่ทราบเวลาใช้งาน'}
            {row.ipAddress && <> · IP <span className="font-mono break-all">{row.ipAddress}</span></>}
          </p>
        </div>
        <Button type="button" variant="outline" aria-label={current ? 'ออกจากระบบอุปกรณ์นี้' : `ออกจากระบบ ${device}`} disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          <ButtonSpinner show={mutation.isPending} />ออกจากระบบ
        </Button>
      </div>
      {mutation.isError && <p role="alert" className="mt-2 text-sm text-destructive">{securityFailureMessage(mutation.error)}</p>}
    </li>
  )
}
