import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import { z } from 'zod'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { toast } from '@workspace/ui/components/toast'
import { cn } from '@workspace/ui/lib/utils'
import { sendVerificationEmail } from '@/lib/auth-client'
import { authSessionQuery } from '@/lib/auth-session'
import { renameProfile } from './account-api'
import { profileNameSchema } from './account-forms'
import { profileQuery, profileQueryKey } from './account-queries'
import { AccountQueryFeedback } from './account-query-feedback'
import { AccountPageHeading } from './account-ui'
import { textLink, settingListClassName } from './account-styles'
import { expireSecuritySession, securityFailureMessage, verificationSentMessage } from './customer-security'
import { EmailChangeForm } from './email-change-form'
import { SettingListSkeleton, SettingRow } from './setting-row'
import { useEditorToggle } from './use-editor-toggle'
import { ButtonSpinner } from '@/components/loading/button-spinner'

type Values = z.infer<typeof profileNameSchema>

function NameRow({ userId, name }: { userId: string; name: string }) {
  const queryClient = useQueryClient()
  const { editing, trigger, open, close } = useEditorToggle()
  const mutation = useMutation({
    mutationFn: (values: Values) => renameProfile(values.name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) })
      void queryClient.invalidateQueries({ queryKey: authSessionQuery.queryKey })
      close()
      toast.add({ title: 'บันทึกชื่อแล้ว', type: 'success' })
    },
  })
  const { register, handleSubmit, setFocus, formState: { errors, isDirty }, reset } = useForm<Values>({
    resolver: zodResolver(profileNameSchema), values: { name },
  })
  useEffect(() => { if (editing) setFocus('name') }, [editing, setFocus])

  function cancel() {
    reset({ name })
    mutation.reset()
    close()
  }

  return (
    <SettingRow id="profile-name" title="ชื่อ" description="ใช้ทักทายในอีเมลและหน้าบัญชี ไม่เกี่ยวกับชื่อผู้รับสินค้า" editing={editing}
      action={<Button ref={trigger} type="button" variant="outline" aria-label="แก้ไขชื่อ" onClick={open}>แก้ไข</Button>}>
      {editing
        ? <form noValidate onSubmit={handleSubmit(values => mutation.mutate(values))} className="max-w-md">
          <FieldGroup className="gap-4">
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="account-name">ชื่อที่แสดง</FieldLabel>
              <Input id="account-name" autoComplete="name" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'account-name-error' : undefined} {...register('name')} />
              <FieldError id="account-name-error">{errors.name?.message}</FieldError>
            </Field>
            {mutation.isError && <p role="alert" className="text-sm text-destructive">บันทึกชื่อไม่สำเร็จ กรุณาลองใหม่</p>}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={!isDirty || mutation.isPending}><ButtonSpinner show={mutation.isPending} />{mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกชื่อ'}</Button>
              <Button type="button" variant="outline" disabled={mutation.isPending} onClick={cancel}>ยกเลิก</Button>
            </div>
          </FieldGroup>
        </form>
        : <p className="py-1 font-medium">{name}</p>}
    </SettingRow>
  )
}

function EmailRow({ email, verified }: { email: string; verified: boolean }) {
  const { editing, trigger, open, close } = useEditorToggle()
  const [pendingEmail, setPendingEmail] = useState('')

  return (
    <SettingRow id="profile-email" title="อีเมล" description="ใช้เข้าสู่ระบบ รับใบเสร็จ และแจ้งเตือนคำสั่งซื้อ" editing={editing}
      action={<Button ref={trigger} type="button" variant="outline" onClick={open}>{pendingEmail ? 'กรอกรหัสยืนยัน' : 'เปลี่ยนอีเมล'}</Button>}>
      <div className="flex flex-col gap-2 py-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="font-medium break-all">{email}</p>
          <Badge variant={verified ? 'success' : 'warning'}>{verified ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน'}</Badge>
        </div>
        {!verified && <EmailVerificationNote email={email} />}
        {pendingEmail && !editing && <p className="text-sm text-muted-foreground">รอยืนยันอีเมลใหม่ <span className="font-medium text-foreground break-all">{pendingEmail}</span></p>}
      </div>
      {editing && <div className="mt-6 border-t pt-6">
        <EmailChangeForm currentEmail={email} pendingEmail={pendingEmail} onPendingEmailChange={setPendingEmail} onClose={close} />
      </div>}
    </SettingRow>
  )
}

function EmailVerificationNote({ email }: { email: string }) {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  // Better Auth sends people back here with ?error when a verification link is stale or invalid.
  const linkFailed = searchParams.has('error')
  const mutation = useMutation({
    mutationFn: () => sendVerificationEmail(email, new URL('/account/profile', window.location.origin).toString()),
    onSuccess: () => {
      if (linkFailed) setSearchParams(params => { params.delete('error'); return params }, { replace: true })
      toast.add({ title: 'ส่งลิงก์ยืนยันแล้ว', description: verificationSentMessage, type: 'success' })
    },
    onError: error => { expireSecuritySession(queryClient, error) },
  })

  return (
    <div className="flex flex-col gap-1 text-sm leading-6">
      <p className={cn('text-pretty', linkFailed ? 'text-destructive' : 'text-muted-foreground')}>
        {linkFailed ? 'ลิงก์ยืนยันอีเมลหมดอายุหรือไม่ถูกต้อง' : 'ยืนยันอีเมลเพื่อรับใบเสร็จและแจ้งเตือนการจัดส่งได้ครบ'}
        {' · '}
        <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className={cn(textLink, 'inline-flex items-center gap-1 disabled:opacity-60')}>
          <ButtonSpinner show={mutation.isPending} />{mutation.isPending ? 'กำลังส่ง...' : 'ส่งลิงก์ยืนยันอีกครั้ง'}
        </button>
      </p>
      {mutation.isError && <p role="alert" className="text-destructive">{securityFailureMessage(mutation.error)}</p>}
    </div>
  )
}

export function Component() {
  const session = useQuery(authSessionQuery).data
  const userId = session?.user.id ?? ''
  const queryClient = useQueryClient()
  // Refetch on focus so verifying from the email in another tab shows up here.
  const profile = useQuery({ ...profileQuery(userId), enabled: Boolean(userId), refetchOnWindowFocus: true })
  const profileVerified = profile.data?.emailVerified

  // The session powers checkout and other pages; keep its verification flag in step with the profile.
  useEffect(() => {
    if (profileVerified !== undefined && session && session.user.emailVerified !== profileVerified) {
      void queryClient.invalidateQueries({ queryKey: authSessionQuery.queryKey })
    }
  }, [profileVerified, queryClient, session])

  return (
    <>
      <title>ข้อมูลส่วนตัว | suannn</title>
      <AccountPageHeading title="ข้อมูลส่วนตัว" description="จัดการชื่อและอีเมลที่ใช้กับบัญชีของคุณ" />
      {profile.isPending ? <SettingListSkeleton rows={2} label="กำลังโหลดข้อมูล" /> : profile.isError ? (
        <AccountQueryFeedback error={profile.error} retry={() => void profile.refetch()} />
      ) : (
        <div className={settingListClassName}>
          <NameRow userId={userId} name={profile.data.name} />
          <EmailRow email={profile.data.email} verified={profile.data.emailVerified} />
        </div>
      )}
    </>
  )
}
