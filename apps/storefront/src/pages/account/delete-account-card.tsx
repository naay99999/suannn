import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { toast } from '@workspace/ui/components/toast'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@workspace/ui/components/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { deleteAccount } from './account-api'
import { accountDeletionFailureMessage, performAccountDeletion } from './customer-security'
import { ButtonSpinner } from '@/components/loading/button-spinner'
import { PasswordInput } from '@/components/password-input'

const deleteSchema = z.object({ currentPassword: z.string().min(1, 'กรุณากรอกรหัสผ่านเพื่อยืนยัน') })
type DeleteValues = z.infer<typeof deleteSchema>

export function DeleteAccountCard() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const form = useForm<DeleteValues>({ resolver: zodResolver(deleteSchema), defaultValues: { currentPassword: '' } })
  const mutation = useMutation({
    mutationFn: (values: DeleteValues) => performAccountDeletion(queryClient, () => deleteAccount(values.currentPassword)),
    onSuccess: () => {
      navigate('/', { replace: true })
      toast.add({ title: 'ลบบัญชีแล้ว', description: 'ขอบคุณที่อุดหนุนผลผลิตจากสวนของเรา', type: 'success' })
    },
  })
  const error = form.formState.errors.currentPassword

  return (
    <Card className="border-destructive/40"><CardHeader><CardTitle role="heading" aria-level={3} className="text-lg font-semibold">ลบบัญชี</CardTitle></CardHeader><CardContent className="gap-4">
      <dl className="grid gap-3 text-sm leading-6 sm:grid-cols-[max-content_1fr] sm:gap-x-6">
        <dt className="font-medium">สิ่งที่ถูกลบ</dt><dd className="text-muted-foreground">ชื่อ อีเมล ที่อยู่ที่บันทึกไว้ ตะกร้า และการเข้าสู่ระบบทุกอุปกรณ์</dd>
        <dt className="font-medium">สิ่งที่เก็บไว้</dt><dd className="text-muted-foreground">ประวัติคำสั่งซื้อและใบเสร็จ เก็บเป็นหลักฐานทางบัญชีโดยไม่ผูกกับตัวตนของคุณ</dd>
        <dt className="font-medium">เงื่อนไข</dt><dd className="text-muted-foreground">ลบได้เมื่อไม่มีคำสั่งซื้อที่ยังไม่เสร็จสิ้น</dd>
      </dl>
      <Dialog open={open} onOpenChange={next => { if (!mutation.isPending) { setOpen(next); form.reset(); mutation.reset() } }}>
        <DialogTrigger render={<Button type="button" variant="destructive" className="self-start" />}>ลบบัญชีของฉัน</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบบัญชีถาวร?</DialogTitle>
            <DialogDescription>การลบบัญชีย้อนกลับไม่ได้ กรอกรหัสผ่านปัจจุบันเพื่อยืนยัน</DialogDescription>
          </DialogHeader>
          <form id="delete-account-form" noValidate onSubmit={form.handleSubmit(values => mutation.mutate(values))}>
            <FieldGroup>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor="delete-account-password">รหัสผ่านปัจจุบัน</FieldLabel>
                <PasswordInput id="delete-account-password" autoComplete="current-password" aria-invalid={Boolean(error)} aria-describedby={error ? 'delete-account-password-error' : undefined} {...form.register('currentPassword')} />
                <FieldError id="delete-account-password-error">{error?.message}</FieldError>
              </Field>
            </FieldGroup>
          </form>
          {mutation.isError && <p role="alert" className="text-sm text-destructive">{accountDeletionFailureMessage(mutation.error)}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button type="submit" form="delete-account-form" variant="destructive" disabled={mutation.isPending}><ButtonSpinner show={mutation.isPending} />{mutation.isPending ? 'กำลังลบบัญชี...' : 'ลบบัญชีถาวร'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardContent></Card>
  )
}
