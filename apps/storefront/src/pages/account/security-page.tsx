import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { changePassword, listSessions, revokeOtherSessions, revokeSession, sendVerificationEmail, signOut } from '@/lib/auth-client'
import { authSessionQuery, accountQueryPrefix } from '@/lib/auth-session'
import { AccountPageHeading } from './account-ui'
import { expireSecuritySession, parseCustomerSessions, performRevokeSession, performSignOut, securityFailureMessage, verificationSentMessage } from './customer-security'

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'กรุณากรอกรหัสผ่านปัจจุบัน'),
  newPassword: z.string().min(12, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 12 ตัวอักษร').max(256),
  confirmPassword: z.string(),
}).refine(values => values.newPassword === values.confirmPassword, {
  path: ['confirmPassword'], message: 'รหัสผ่านใหม่ไม่ตรงกัน',
})
type PasswordValues = z.infer<typeof passwordSchema>

export function Component() {
  const session = useQuery(authSessionQuery).data
  const userId = session?.user.id ?? ''
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const sessionsKey = [...accountQueryPrefix(userId), 'sessions'] as const
  const sessions = useQuery({
    queryKey: sessionsKey,
    queryFn: async () => parseCustomerSessions(await listSessions()),
    enabled: Boolean(userId), retry: false,
  })
  useEffect(() => {
    if (sessions.isError) expireSecuritySession(queryClient, sessions.error)
  }, [queryClient, sessions.error, sessions.isError])
  const handleSecurityError = (err: unknown) => {
    if (!expireSecuritySession(queryClient, err)) setError(securityFailureMessage(err))
  }
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })
  const verifyMutation = useMutation({
    mutationFn: () => sendVerificationEmail(session!.user.email, new URL('/account/security', window.location.origin).toString()),
    onSuccess: () => setNotice(verificationSentMessage),
    onError: handleSecurityError,
  })
  const passwordMutation = useMutation({
    mutationFn: (values: PasswordValues) => changePassword(values.currentPassword, values.newPassword),
    onSuccess: () => { form.reset(); setNotice('เปลี่ยนรหัสผ่านแล้ว') },
    onError: handleSecurityError,
  })
  const signOutMutation = useMutation({
    mutationFn: () => performSignOut(queryClient, signOut),
    onSuccess: () => navigate('/sign-in', { replace: true }),
    onError: handleSecurityError,
  })
  const revokeMutation = useMutation({
    mutationFn: async (row: { token: string; id: string }) => performRevokeSession(queryClient, row.token, row.id === session?.session.id, revokeSession),
    onSuccess: async current => {
      if (current) navigate('/sign-in', { replace: true })
      else { await queryClient.invalidateQueries({ queryKey: sessionsKey }); setNotice('ออกจากอุปกรณ์ที่เลือกแล้ว') }
    },
    onError: handleSecurityError,
  })
  const revokeOthersMutation = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: sessionsKey }); setNotice('ออกจากอุปกรณ์อื่นทั้งหมดแล้ว') },
    onError: handleSecurityError,
  })

  return (
    <>
      <title>ความปลอดภัยบัญชี | suannn</title>
      <AccountPageHeading title="ความปลอดภัย" description="จัดการอีเมล รหัสผ่าน และอุปกรณ์ที่เข้าสู่ระบบ" />
      {searchParams.has('error') && <p role="alert" className="mb-6 rounded-xl border border-destructive/30 p-4 text-sm text-destructive">ลิงก์ยืนยันอีเมลหมดอายุหรือไม่ถูกต้อง กรุณาส่งลิงก์ใหม่</p>}
      {notice && <p role="status" className="mb-6 rounded-xl bg-accent p-4 text-sm text-primary-ink">{notice}</p>}
      {error && <p role="alert" className="mb-6 text-sm text-destructive">{error}</p>}
      <div className="flex flex-col gap-5">
        <Card><CardHeader><CardTitle className="text-lg">การยืนยันอีเมล</CardTitle></CardHeader><CardContent className="gap-4"><p className="text-sm leading-7 text-muted-foreground">{session?.user.emailVerified ? 'ยืนยันอีเมลแล้ว' : 'ยังไม่ได้ยืนยันอีเมล'} · {session?.user.email}</p>{!session?.user.emailVerified && <Button type="button" variant="outline" disabled={verifyMutation.isPending} onClick={() => { setNotice(''); setError(''); verifyMutation.mutate() }}>ส่งอีเมลยืนยันอีกครั้ง</Button>}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-lg">เปลี่ยนรหัสผ่าน</CardTitle></CardHeader><CardContent>
          <form noValidate onSubmit={form.handleSubmit(values => { setNotice(''); setError(''); passwordMutation.mutate(values) })} className="max-w-lg">
            <FieldGroup className="gap-5">
              <Field data-invalid={Boolean(form.formState.errors.currentPassword)}><FieldLabel htmlFor="current-password">รหัสผ่านปัจจุบัน</FieldLabel><Input id="current-password" type="password" autoComplete="current-password" aria-invalid={Boolean(form.formState.errors.currentPassword)} {...form.register('currentPassword')} /><FieldError>{form.formState.errors.currentPassword?.message}</FieldError></Field>
              <Field data-invalid={Boolean(form.formState.errors.newPassword)}><FieldLabel htmlFor="new-password">รหัสผ่านใหม่</FieldLabel><Input id="new-password" type="password" autoComplete="new-password" aria-invalid={Boolean(form.formState.errors.newPassword)} {...form.register('newPassword')} /><FieldError>{form.formState.errors.newPassword?.message}</FieldError></Field>
              <Field data-invalid={Boolean(form.formState.errors.confirmPassword)}><FieldLabel htmlFor="confirm-new-password">ยืนยันรหัสผ่านใหม่</FieldLabel><Input id="confirm-new-password" type="password" autoComplete="new-password" aria-invalid={Boolean(form.formState.errors.confirmPassword)} {...form.register('confirmPassword')} /><FieldError>{form.formState.errors.confirmPassword?.message}</FieldError></Field>
              <Button type="submit" disabled={passwordMutation.isPending}>บันทึกรหัสผ่านใหม่</Button>
            </FieldGroup>
          </form>
          <Link to="/forgot-password" className="mt-5 inline-block text-sm font-medium text-primary-ink underline underline-offset-4">ลืมรหัสผ่านปัจจุบัน?</Link>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-lg">อุปกรณ์ที่เข้าสู่ระบบ</CardTitle></CardHeader><CardContent className="gap-5">
          {sessions.isPending ? <p role="status" className="text-muted-foreground">กำลังโหลดอุปกรณ์...</p> : sessions.isError ? <div role="alert" className="flex flex-wrap items-center gap-3"><p>โหลดรายการอุปกรณ์ไม่ได้</p><Button type="button" variant="outline" onClick={() => void sessions.refetch()}>ลองอีกครั้ง</Button></div> : sessions.data.length ? <ul className="flex flex-col gap-3">{sessions.data.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4"><div><p className="font-medium">{row.userAgent || 'อุปกรณ์ที่ไม่ระบุชื่อ'}</p><p className="text-xs text-muted-foreground">{row.id === session?.session.id ? 'อุปกรณ์นี้' : 'อุปกรณ์อื่น'}{row.createdAt && ` · ${new Date(row.createdAt).toLocaleDateString('th-TH')}`}</p></div><Button type="button" size="sm" variant="outline" disabled={revokeMutation.isPending} onClick={() => { setNotice(''); setError(''); revokeMutation.mutate(row) }}>ออกจากอุปกรณ์นี้</Button></li>)}</ul> : <p className="text-muted-foreground">ไม่พบรายการอุปกรณ์</p>}
          <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={revokeOthersMutation.isPending} onClick={() => { setNotice(''); setError(''); revokeOthersMutation.mutate() }}>ออกจากอุปกรณ์อื่นทั้งหมด</Button><Button type="button" variant="destructive" disabled={signOutMutation.isPending} onClick={() => { setNotice(''); setError(''); signOutMutation.mutate() }}>ออกจากระบบ</Button></div>
        </CardContent></Card>
      </div>
    </>
  )
}
