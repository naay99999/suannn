import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { authSessionQuery } from '@/lib/auth-session'
import { renameProfile } from './account-api'
import { profileNameSchema } from './account-forms'
import { profileQuery, profileQueryKey } from './account-queries'
import { AccountQueryFeedback } from './account-query-feedback'
import { AccountPageHeading } from './account-ui'
import { EmailChangeForm } from './email-change-form'

type Values = z.infer<typeof profileNameSchema>

function ProfileEditor({ userId, name }: { userId: string; name: string }) {
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)
  const mutation = useMutation({
    mutationFn: (values: Values) => renameProfile(values.name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) })
      setSaved(true)
    },
  })
  const { register, handleSubmit, formState: { errors, isDirty }, reset } = useForm<Values>({
    resolver: zodResolver(profileNameSchema), values: { name },
  })

  return (
    <form noValidate onSubmit={handleSubmit(values => mutation.mutate(values))}>
      <FieldGroup className="gap-5">
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="account-name">ชื่อที่แสดง</FieldLabel>
          <Input id="account-name" autoComplete="name" aria-invalid={Boolean(errors.name)} {...register('name', { onChange: () => setSaved(false) })} />
          <FieldError>{errors.name?.message}</FieldError>
        </Field>
        {mutation.isError && <p role="alert" className="text-sm text-destructive">บันทึกชื่อไม่ได้ กรุณาลองใหม่</p>}
        {saved && <p role="status" className="text-sm text-primary-ink">บันทึกชื่อแล้ว</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="storefront" disabled={!isDirty || mutation.isPending}>บันทึกชื่อ</Button>
          <Button type="button" variant="outline" size="storefront" onClick={() => { reset({ name }); setSaved(false) }}>ยกเลิก</Button>
        </div>
      </FieldGroup>
    </form>
  )
}

export function Component() {
  const session = useQuery(authSessionQuery).data
  const userId = session?.user.id ?? ''
  const profile = useQuery({ ...profileQuery(userId), enabled: Boolean(userId) })

  return (
    <>
      <title>ข้อมูลส่วนตัว | suannn</title>
      <AccountPageHeading title="ข้อมูลส่วนตัว" description="จัดการชื่อและอีเมลที่ใช้กับบัญชีของคุณ" />
      {profile.isPending ? <p role="status" className="py-12 text-muted-foreground">กำลังโหลดข้อมูล...</p> : profile.isError ? (
        <AccountQueryFeedback error={profile.error} retry={() => void profile.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle className="text-lg">ชื่อที่แสดง</CardTitle></CardHeader>
            <CardContent><ProfileEditor userId={userId} name={profile.data.name} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-lg">อีเมล</CardTitle></CardHeader>
            <CardContent className="gap-5">
              <p className="text-sm">อีเมลปัจจุบัน <strong>{profile.data.email}</strong></p>
              <p className="text-sm text-muted-foreground">{profile.data.emailVerified ? 'ยืนยันอีเมลแล้ว' : 'ยังไม่ได้ยืนยันอีเมล'}</p>
              <EmailChangeForm />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
