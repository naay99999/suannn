import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { FieldGroup } from '@workspace/ui/components/field'
import { toast } from '@workspace/ui/components/toast'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { farmsApi, type Farm } from '@/lib/farms/api'
import { emptyFarmValues, farmSchema, fromFarm, toFarmCreateInput, toFarmUpdateInput, type FarmFormValues } from '@/lib/farms/forms'
import { farmKeys, farmsQuery, invalidateFarms } from '@/lib/farms/queries'
import { ConfirmActionDialog } from '@/pages/products/_components/product-actions'
import { FormInput, FormTextarea } from '@/pages/products/_components/product-form'

type FarmFormProps =
  | { mode: 'create'; onCreated: (farmId: string) => void; onDirtyChange: (dirty: boolean) => void }
  | { mode: 'edit'; farm: Farm; onCancel: () => void; onSaved: () => void; onDirtyChange: (dirty: boolean) => void }

function isAmbiguousCreateFailure(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && (error.status === 0 || error.status >= 500)
}

export function FarmForm(props: FarmFormProps) {
  const queryClient = useQueryClient()
  const isCreate = props.mode === 'create'
  const form = useForm<FarmFormValues>({
    resolver: zodResolver(farmSchema),
    defaultValues: isCreate ? emptyFarmValues : fromFarm(props.farm),
  })
  const [serverError, setServerError] = useState<string | null>(null)
  const [createdFarmId, setCreatedFarmId] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [createRecoveryStatus, setCreateRecoveryStatus] = useState<'idle' | 'checking' | 'ready' | 'failed'>('idle')
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const onCreated = props.mode === 'create' ? props.onCreated : null
  const onDirtyChange = props.onDirtyChange
  const coverImageUrl = useWatch({ control: form.control, name: 'coverImageUrl' })
  const coverImageAlt = useWatch({ control: form.control, name: 'coverImageAlt' })

  useEffect(() => {
    if (createdFarmId) onCreated?.(createdFarmId)
  }, [createdFarmId, onCreated])

  useEffect(() => {
    onDirtyChange(form.formState.isDirty)
  }, [form.formState.isDirty, onDirtyChange])

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const refreshAfterUncertainCreate = async () => {
    setCreateRecoveryStatus('checking')
    await queryClient.invalidateQueries({ queryKey: farmKeys.lists(), refetchType: 'none' })
    try {
      await queryClient.fetchQuery({ ...farmsQuery({ limit: 25 }), staleTime: 0 })
      setCreateRecoveryStatus('ready')
    } catch {
      setCreateRecoveryStatus('failed')
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    try {
      if (props.mode === 'create') {
        const created = await farmsApi.create(toFarmCreateInput(values))
        await invalidateFarms(queryClient, created.id)
        toast.add({ title: 'สร้างฟาร์มแล้ว', type: 'success' })
        form.reset(emptyFarmValues)
        onDirtyChange(false)
        setCreatedFarmId(created.id)
      } else {
        await farmsApi.update(props.farm.id, toFarmUpdateInput(values))
        await invalidateFarms(queryClient, props.farm.id)
        toast.add({ title: 'บันทึกข้อมูลฟาร์มแล้ว', type: 'success' })
        form.reset(values)
        onDirtyChange(false)
        props.onSaved()
      }
    } catch (error) {
      if (props.mode === 'create' && isAmbiguousCreateFailure(error)) {
        setServerError(`${apiErrorMessage(error)} หากไม่แน่ใจว่าบันทึกสำเร็จหรือไม่ ให้ตรวจสอบรายการฟาร์มก่อนสร้างใหม่ ระบบจะไม่ส่งคำขอสร้างซ้ำโดยอัตโนมัติ`)
        await refreshAfterUncertainCreate()
        return
      }
      setServerError(apiErrorMessage(error))
      if (props.mode === 'edit' && error instanceof ApiRequestError && error.status === 409) {
        await invalidateFarms(queryClient, props.farm.id)
      }
    }
  })

  const errors = form.formState.errors
  const pending = form.formState.isSubmitting
  const imageFailed = Boolean(coverImageUrl && failedImageUrl === coverImageUrl)

  return (
    <section className="flex flex-col gap-5 rounded-lg border p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{isCreate ? 'ข้อมูลฟาร์มใหม่' : 'แก้ไขข้อมูลฟาร์ม'}</h2>
        <p className="text-sm text-muted-foreground">ฟาร์มใหม่จะเป็นฉบับร่าง ต้องกรอกข้อมูลให้ครบก่อนเผยแพร่</p>
      </div>
      <form className="flex flex-col gap-6" noValidate onSubmit={onSubmit}>
        <FieldGroup>
          <div className="grid gap-5 md:grid-cols-2">
            <FormInput
              id="farm-slug"
              label="ชื่อ URL ฟาร์ม"
              description={isCreate ? 'ใช้ตัวอักษรภาษาอังกฤษตัวเล็ก ตัวเลข และขีดกลาง' : 'ชื่อ URL เปลี่ยนไม่ได้หลังสร้างฟาร์ม'}
              error={errors.slug?.message}
              disabled={pending}
              {...form.register('slug')}
              required={isCreate}
              readOnly={!isCreate}
            />
            <FormInput disabled={pending} id="farm-name" label="ชื่อฟาร์ม" error={errors.name?.message} {...form.register('name')} required />
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <FormInput disabled={pending} id="farm-farmer-name" label="ชื่อเกษตรกร" error={errors.farmerName?.message} {...form.register('farmerName')} />
            <FormInput disabled={pending} id="farm-province" label="จังหวัด" error={errors.province?.message} {...form.register('province')} />
            <FormInput disabled={pending} id="farm-district" label="อำเภอ" error={errors.district?.message} {...form.register('district')} />
          </div>
          <FormTextarea disabled={pending} id="farm-summary" label="สรุปสั้น" description="แสดงในรายการฟาร์ม ไม่เกิน 300 ตัวอักษร" error={errors.summary?.message} {...form.register('summary')} />
          <FormTextarea disabled={pending} id="farm-story" label="เรื่องราวของฟาร์ม" error={errors.story?.message} {...form.register('story')} />
          <FormTextarea disabled={pending} id="farm-growing-practices" label="วิธีการปลูก" error={errors.growingPractices?.message} {...form.register('growingPractices')} />
          <div className="grid gap-5 md:grid-cols-2">
            <FormInput disabled={pending} id="farm-cover-image-url" label="URL รูปปก HTTPS" description="วาง URL รูปภาพ HTTPS ที่เปิดดูได้ ไม่มีระบบอัปโหลดรูป" error={errors.coverImageUrl?.message} {...form.register('coverImageUrl')} />
            <FormInput disabled={pending} id="farm-cover-image-alt" label="คำอธิบายรูปปก" error={errors.coverImageAlt?.message} {...form.register('coverImageAlt')} />
            <FormInput disabled={pending} id="farm-portrait-image-url" label="URL รูปเกษตรกร HTTPS" error={errors.portraitImageUrl?.message} {...form.register('portraitImageUrl')} />
            <FormInput disabled={pending} id="farm-portrait-image-alt" label="คำอธิบายรูปเกษตรกร" description="จำเป็นเมื่อมีรูปเกษตรกร" error={errors.portraitImageAlt?.message} {...form.register('portraitImageAlt')} />
          </div>
        </FieldGroup>

        <div className="flex flex-col gap-3 rounded-md border p-4">
          <h3 className="font-medium">ตัวอย่างรูปปก</h3>
          {coverImageUrl && !imageFailed
            ? <img alt={coverImageAlt || ''} className="max-h-64 w-full rounded-md border object-contain" onError={() => setFailedImageUrl(coverImageUrl)} src={coverImageUrl} />
            : <div aria-label="ไม่มีรูปภาพ" className="grid min-h-32 place-items-center rounded-md bg-muted text-sm text-muted-foreground" role="img">{imageFailed ? 'โหลดรูปภาพไม่ได้' : 'ยังไม่มีรูปปก'}</div>}
        </div>

        {serverError && <div aria-live="assertive" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{serverError}</div>}
        {createRecoveryStatus === 'checking' && <p className="text-sm text-muted-foreground" role="status">กำลังตรวจสอบรายการฟาร์มล่าสุด...</p>}
        {createRecoveryStatus === 'ready' && <Link className={buttonVariants({ variant: 'outline' })} to="/farms">ตรวจสอบรายการฟาร์ม</Link>}
        {createRecoveryStatus === 'failed' && <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-destructive" role="alert">อัปเดตรายการฟาร์มไม่สำเร็จ กรุณาตรวจสอบรายการก่อนสร้างฟาร์มอีกครั้ง</p>
          <Button disabled={pending} onClick={() => void refreshAfterUncertainCreate()} type="button" variant="outline">ลองโหลดรายการฟาร์มอีกครั้ง</Button>
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || (isCreate && createRecoveryStatus !== 'idle')} type="submit">{pending ? 'กำลังบันทึก...' : isCreate ? 'สร้างฟาร์ม' : 'บันทึกฟาร์ม'}</Button>
          {props.mode === 'edit' && <Button disabled={pending} onClick={() => form.formState.isDirty ? setConfirmCancel(true) : props.onCancel()} type="button" variant="outline">ยกเลิกการแก้ไข</Button>}
        </div>
      </form>
      {props.mode === 'edit' && <ConfirmActionDialog
        open={confirmCancel}
        title="ทิ้งการแก้ไขฟาร์ม?"
        description="ข้อมูลที่แก้ไขยังไม่ได้บันทึกจะหายไป"
        confirmLabel="ทิ้งการเปลี่ยนแปลง"
        onOpenChange={setConfirmCancel}
        onConfirm={() => {
          setConfirmCancel(false)
          props.onCancel()
        }}
      />}
    </section>
  )
}
