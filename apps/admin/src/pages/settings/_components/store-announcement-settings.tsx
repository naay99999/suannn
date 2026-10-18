import { useEffect, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import { Button } from '@workspace/ui/components/button'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Field, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { toast } from '@workspace/ui/components/toast'
import { QueryState } from '@/components/query-state'
import { authSessionQuery } from '@/lib/auth-session'
import { hasPermission } from '@/lib/permissions'
import { formatTimestamp } from '@/lib/format'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { storeAnnouncementApi, type StoreAnnouncement } from '@/lib/store-announcement/api'
import {
  fromStoreAnnouncement,
  storeAnnouncementSchema,
  toStoreAnnouncementInput,
  type StoreAnnouncementFormValues,
} from '@/lib/store-announcement/forms'
import { FormInput, FormTextarea } from '@/pages/products/_components/product-form'

const announcementKey = ['store-announcement'] as const

export function StoreAnnouncementSettings() {
  const session = useQuery(authSessionQuery)
  const canRead = hasPermission(session.data, 'settings:read')
  const announcement = useQuery({ queryKey: announcementKey, queryFn: storeAnnouncementApi.get, enabled: canRead, retry: false })

  if (session.isPending) return <QueryState kind="loading" />
  if (session.isError) return <QueryState kind="error" message="ตรวจสอบสิทธิ์ไม่ได้" onRetry={() => void session.refetch()} />
  if (!canRead) return <QueryState kind="forbidden" message="คุณไม่มีสิทธิ์ดูแถบโปรโมชัน" />
  if (announcement.isPending) return <QueryState kind="loading" />
  if (!announcement.data) return <QueryState kind="error" message="โหลดแถบโปรโมชันไม่สำเร็จ" onRetry={() => void announcement.refetch()} />

  return <StoreAnnouncementForm announcement={announcement.data} canUpdate={hasPermission(session.data, 'settings:update')} />
}

function StoreAnnouncementForm({ announcement, canUpdate }: { announcement: StoreAnnouncement; canUpdate: boolean }) {
  const client = useQueryClient()
  const form = useForm<StoreAnnouncementFormValues>({
    resolver: zodResolver(storeAnnouncementSchema),
    defaultValues: fromStoreAnnouncement(announcement),
  })
  const [serverError, setServerError] = useState<string | null>(null)
  const preview = useWatch({ control: form.control })
  const { isDirty, isSubmitting: pending, errors } = form.formState
  const disabled = !canUpdate || pending

  useEffect(() => {
    if (!isDirty) form.reset(fromStoreAnnouncement(announcement))
  }, [announcement, form, isDirty])

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    try {
      const saved = await storeAnnouncementApi.update(toStoreAnnouncementInput(values))
      client.setQueryData(announcementKey, saved)
      form.reset(fromStoreAnnouncement(saved))
      toast.add({ title: 'บันทึกแถบโปรโมชันแล้ว', type: 'success' })
    } catch (error) {
      setServerError(apiErrorMessage(error))
      const status = error instanceof ApiRequestError ? error.status : 0
      if (status === 0 || status >= 500) await client.invalidateQueries({ queryKey: announcementKey })
    }
  })

  return (
    <section className="flex max-w-3xl flex-col gap-6 rounded-xl border bg-card p-5 md:p-7">
      <div>
        <h2 className="text-xl font-semibold">แถบโปรโมชันหน้าร้าน</h2>
        <p className="mt-1 text-sm text-muted-foreground">ข้อความที่แสดงด้านบนสุดของทุกหน้าในร้าน ยกเว้นหน้าเข้าสู่ระบบและ checkout</p>
      </div>
      <dl className="grid gap-2 rounded-lg bg-muted/40 p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">สถานะที่บันทึกแล้ว</dt><dd className="font-medium">{announcement.enabled ? 'เปิดแสดง' : 'ปิด'}</dd></div>
        <div><dt className="text-muted-foreground">เวอร์ชัน {announcement.version}</dt><dd>{formatTimestamp(announcement.updatedAt)}</dd></div>
      </dl>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">ตัวอย่าง</p>
        <AnnouncementPreview values={preview} />
      </div>

      <form className="flex flex-col gap-6" noValidate onSubmit={onSubmit}>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="announcement-enabled">
              <Controller
                control={form.control}
                name="enabled"
                render={({ field }) => <Checkbox checked={field.value} disabled={disabled} id="announcement-enabled" onCheckedChange={field.onChange} />}
              />
              เปิดแสดงแถบโปรโมชัน
            </FieldLabel>
          </Field>
          <FormInput disabled={disabled} id="announcement-message" label="ข้อความ" description="ไม่เกิน 160 ตัวอักษร" placeholder="เช่น ลด 25% ทุเรียนหมอนทองถึงสิ้นเดือนนี้" error={errors.message?.message} {...form.register('message')} />
          <div className="grid gap-5 md:grid-cols-2">
            <FormInput disabled={disabled} id="announcement-link-label" label="ข้อความลิงก์" placeholder="เช่น ดูสินค้า" error={errors.linkLabel?.message} {...form.register('linkLabel')} />
            <FormInput disabled={disabled} id="announcement-link-url" label="URL ลิงก์" description="path ในเว็บ เช่น /products หรือ https://" placeholder="/products" error={errors.linkUrl?.message} {...form.register('linkUrl')} />
          </div>
          <FormTextarea disabled={disabled} id="announcement-details" label="รายละเอียด (ปุ่ม i)" description="เงื่อนไขโปรโมชัน แสดงเมื่อลูกค้ากดไอคอน ไม่เกิน 500 ตัวอักษร" error={errors.details?.message} {...form.register('details')} />
          <div className="grid gap-5 md:grid-cols-2">
            <FormInput disabled={disabled} id="announcement-starts-at" label="เริ่มแสดง" description="เว้นว่างเพื่อแสดงทันที" type="datetime-local" error={errors.startsAt?.message} {...form.register('startsAt')} />
            <FormInput disabled={disabled} id="announcement-ends-at" label="สิ้นสุด" description="เว้นว่างเพื่อแสดงจนกว่าจะปิด" type="datetime-local" error={errors.endsAt?.message} {...form.register('endsAt')} />
          </div>
        </FieldGroup>
        {serverError && <p aria-live="assertive" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{serverError}</p>}
        {canUpdate && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending || !isDirty} type="submit">{pending ? 'กำลังบันทึก...' : 'บันทึกแถบโปรโมชัน'}</Button>
            <Button disabled={pending || !isDirty} onClick={() => form.reset(fromStoreAnnouncement(announcement))} type="button" variant="outline">ยกเลิกการแก้ไข</Button>
          </div>
        )}
      </form>
    </section>
  )
}

function AnnouncementPreview({ values }: { values: Partial<StoreAnnouncementFormValues> }) {
  const message = values.message?.trim()
  if (!message) {
    return <div className="grid min-h-10 place-items-center rounded-md bg-muted text-sm text-muted-foreground">ยังไม่มีข้อความ</div>
  }
  return (
    <div aria-label="ตัวอย่างแถบโปรโมชัน" className={values.enabled ? '' : 'opacity-50'} role="img">
      <p className="flex min-h-10 flex-wrap items-center justify-center gap-x-1.5 rounded-md bg-foreground px-4 py-2 text-center text-sm font-medium text-background">
        <span>{message}</span>
        {values.linkLabel?.trim() && <span className="font-semibold underline underline-offset-4">{values.linkLabel.trim()}</span>}
        {values.details?.trim() && <HugeiconsIcon icon={InformationCircleIcon} className="size-4.5" aria-hidden="true" />}
      </p>
    </div>
  )
}
