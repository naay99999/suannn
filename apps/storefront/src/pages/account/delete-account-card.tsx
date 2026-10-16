import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@workspace/ui/components/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { deleteAccount } from './account-api'
import { accountDeletionFailureMessage, performAccountDeletion } from './customer-security'

const deleteSchema = z.object({ currentPassword: z.string().min(1, 'กรุณากรอกรหัสผ่านเพื่อยืนยัน') })
type DeleteValues = z.infer<typeof deleteSchema>

export function DeleteAccountCard() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const form = useForm<DeleteValues>({ resolver: zodResolver(deleteSchema), defaultValues: { currentPassword: '' } })
  const mutation = useMutation({
    mutationFn: (values: DeleteValues) => performAccountDeletion(queryClient, () => deleteAccount(values.currentPassword)),
    onSuccess: () => navigate('/', { replace: true }),
  })
  const error = form.formState.errors.currentPassword

  return (
    <Card><CardHeader><CardTitle className="text-lg">ลบบัญชี</CardTitle></CardHeader><CardContent className="gap-4">
      <p className="text-sm leading-7 text-muted-foreground">ระบบจะลบชื่อ อีเมล ที่อยู่ ตะกร้า และการเข้าสู่ระบบของคุณ ส่วนประวัติคำสั่งซื้อจะเก็บไว้เป็นหลักฐานทางบัญชีโดยไม่ผูกกับตัวตนของคุณ ลบได้เมื่อไม่มีคำสั่งซื้อที่ยังไม่เสร็จสิ้น</p>
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
                <Input id="delete-account-password" type="password" autoComplete="current-password" aria-invalid={Boolean(error)} {...form.register('currentPassword')} />
                <FieldError>{error?.message}</FieldError>
              </Field>
            </FieldGroup>
          </form>
          {mutation.isError && <p role="alert" className="text-sm text-destructive">{accountDeletionFailureMessage(mutation.error)}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button type="submit" form="delete-account-form" variant="destructive" disabled={mutation.isPending}>{mutation.isPending ? 'กำลังลบบัญชี...' : 'ลบบัญชีถาวร'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardContent></Card>
  )
}
