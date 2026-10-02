import { useEffect, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@workspace/ui/components/button'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet, FieldLegend } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { formatMoney } from '@/lib/format'
import type { Variant } from '@/lib/catalog/api'
import {
  toVariantCreateInput,
  toVariantUpdateInput,
  variantCreateSchema,
  variantEditSchema,
  type VariantCreateValues,
  type VariantEditValues,
} from '@/lib/catalog/forms'
import { ConfirmActionDialog } from './product-actions'

type VariantDialogProps = {
  open: boolean
  variant: Variant | null
  onOpenChange: (open: boolean) => void
  onDirtyChange: (dirty: boolean) => void
  latestVariant: Variant | null
  onRefreshLatest: () => Promise<void>
  refreshFailed: boolean
  onSave: (input: ReturnType<typeof toVariantCreateInput> | ReturnType<typeof toVariantUpdateInput>, variantId?: string) => Promise<void>
}

function defaultValues(variant: Variant | null): VariantCreateValues {
  return {
    sku: variant?.sku ?? '',
    name: variant?.name ?? '',
    unit: variant?.unit ?? '',
    priceBaht: variant ? (variant.priceSatang / 100).toFixed(2) : '',
    salesEnabled: variant?.salesEnabled ?? true,
    displayOrder: variant?.displayOrder ?? 0,
    minRemainingShelfLifeDays: variant?.minRemainingShelfLifeDays ?? 0,
  }
}

export function VariantDialog({ open, variant, onOpenChange, onDirtyChange, latestVariant, onRefreshLatest, refreshFailed, onSave }: VariantDialogProps) {
  const isEdit = Boolean(variant)
  const form = useForm<VariantCreateValues | VariantEditValues>({
    resolver: zodResolver(isEdit ? variantEditSchema : variantCreateSchema),
    defaultValues: defaultValues(variant),
  })
  const [serverError, setServerError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [saving, setSaving] = useState(false)
  const [conflictDetected, setConflictDetected] = useState(false)
  const latestArchived = isEdit && Boolean(latestVariant?.archivedAt)

  useEffect(() => {
    onDirtyChange(form.formState.isDirty)
  }, [form.formState.isDirty, onDirtyChange])

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const requestClose = () => {
    if (form.formState.isDirty) setConfirmDiscard(true)
    else onOpenChange(false)
  }

  const submit = form.handleSubmit(async (values) => {
    setServerError(null)
    setSaving(true)
    try {
      const input = isEdit
        ? toVariantUpdateInput(values as VariantEditValues)
        : toVariantCreateInput(values as VariantCreateValues)
      await onSave(input, variant?.id)
      form.reset(values)
      onDirtyChange(false)
      onOpenChange(false)
    } catch (error) {
      const message = apiErrorMessage(error)
      const conflict = error instanceof ApiRequestError && error.status === 409
      setServerError(conflict
        ? 'ข้อมูลเปลี่ยนแปลงบนเซิร์ฟเวอร์ ตรวจสอบสถานะล่าสุดก่อนบันทึกอีกครั้ง'
        : message)
      if (conflict && isEdit) setConflictDetected(true)
    } finally {
      setSaving(false)
    }
  })

  const errors = form.formState.errors
  const fieldError = (field: keyof typeof errors) => errors[field]?.message

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && requestClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'แก้ไขรูปแบบสินค้า' : 'เพิ่มรูปแบบสินค้า'}</DialogTitle>
            <DialogDescription>SKU ใช้ระบุตัวตนของรูปแบบสินค้าและเปลี่ยนไม่ได้หลังสร้าง</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-5" noValidate onSubmit={submit}>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <VariantInput disabled={saving || latestArchived} id="variant-sku" label="SKU" error={fieldError('sku')} {...form.register('sku')} readOnly={isEdit} required={!isEdit} />
                <VariantInput disabled={saving || latestArchived} id="variant-name" label="ชื่อรูปแบบ" error={fieldError('name')} {...form.register('name')} required />
                <VariantInput disabled={saving || latestArchived} id="variant-unit" label="หน่วย" error={fieldError('unit')} {...form.register('unit')} required />
                <VariantInput disabled={saving || latestArchived} id="variant-price" label="ราคา (บาท)" error={fieldError('priceBaht')} inputMode="decimal" placeholder="0.00" {...form.register('priceBaht')} required />
                <VariantInput disabled={saving || latestArchived} id="variant-order" label="ลำดับการแสดง" error={fieldError('displayOrder')} type="number" {...form.register('displayOrder', { valueAsNumber: true })} />
                <VariantInput disabled={saving || latestArchived} id="variant-shelf-life" label="อายุคงเหลือขั้นต่ำ (วัน)" error={fieldError('minRemainingShelfLifeDays')} type="number" {...form.register('minRemainingShelfLifeDays', { valueAsNumber: true })} />
              </div>
              {isEdit && <p className="text-sm text-muted-foreground">SKU {variant?.sku} เปลี่ยนไม่ได้</p>}
              <FieldSet>
                <FieldLegend variant="label">การขาย</FieldLegend>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="variant-sales-enabled">
                    <Controller
                      control={form.control}
                      name="salesEnabled"
                      render={({ field }) => <Checkbox checked={field.value} disabled={saving || latestArchived} id="variant-sales-enabled" onCheckedChange={field.onChange} />}
                    />
                    เปิดขายรูปแบบนี้
                  </FieldLabel>
                </Field>
                <FieldDescription>เมื่อปิดขาย รูปแบบสินค้าจะยังอยู่ในแค็ตตาล็อกสำหรับการจัดการสต็อก</FieldDescription>
              </FieldSet>
            </FieldGroup>
            {serverError && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{serverError}</p>}
            {conflictDetected && isEdit && <section aria-label="สถานะรูปแบบสินค้าล่าสุด" className="flex flex-col gap-3 rounded-md border p-3">
              <h3 className="font-medium">ตรวจสอบข้อมูลล่าสุดจากเซิร์ฟเวอร์</h3>
              {refreshFailed || !latestVariant
                ? <p className="text-sm text-muted-foreground" role="status">โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาลองโหลดอีกครั้งก่อนบันทึก</p>
                : <>
                  <dl className="grid gap-2 text-sm sm:grid-cols-3">
                    <div><dt className="font-medium">ชื่อรูปแบบ</dt><dd className="text-muted-foreground">{latestVariant.name}</dd></div>
                    <div><dt className="font-medium">หน่วย</dt><dd className="text-muted-foreground">{latestVariant.unit}</dd></div>
                    <div><dt className="font-medium">ราคา</dt><dd className="text-muted-foreground">{formatMoney(latestVariant.priceSatang)}</dd></div>
                  </dl>
                  {latestArchived && <p className="text-sm text-destructive" role="status">รูปแบบสินค้านี้ถูกเก็บถาวรแล้วบนเซิร์ฟเวอร์</p>}
                  <Button disabled={saving} onClick={() => {
                    form.reset(defaultValues(latestVariant))
                    onDirtyChange(false)
                    setConflictDetected(false)
                    setServerError(null)
                  }} type="button" variant="outline">ใช้ข้อมูลล่าสุด</Button>
                </>}
              <Button disabled={saving} onClick={() => void onRefreshLatest()} type="button" variant="outline">โหลดข้อมูลล่าสุด</Button>
            </section>}
            <DialogFooter>
              <Button disabled={saving} onClick={requestClose} type="button" variant="outline">ยกเลิก</Button>
              <Button disabled={saving || conflictDetected || latestArchived} type="submit">{saving ? 'กำลังบันทึก...' : 'บันทึกรูปแบบสินค้า'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={confirmDiscard}
        title="ทิ้งการเปลี่ยนแปลงรูปแบบสินค้า?"
        description="ข้อมูลที่แก้ไขในหน้าต่างนี้จะหายไป"
        confirmLabel="ทิ้งการเปลี่ยนแปลง"
        onOpenChange={setConfirmDiscard}
        onConfirm={() => {
          setConfirmDiscard(false)
          form.reset(defaultValues(variant))
          onDirtyChange(false)
          onOpenChange(false)
        }}
      />
    </>
  )
}

function VariantInput({ id, label, error, ...props }: {
  id: string
  label: string
  error?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  const errorId = `${id}-error`
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} id={id} {...props} />
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  )
}
