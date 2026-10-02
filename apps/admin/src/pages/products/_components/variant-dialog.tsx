import { useState } from 'react'
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

export function VariantDialog({ open, variant, onOpenChange, onSave }: VariantDialogProps) {
  const isEdit = Boolean(variant)
  const form = useForm<VariantCreateValues | VariantEditValues>({
    resolver: zodResolver(isEdit ? variantEditSchema : variantCreateSchema),
    defaultValues: defaultValues(variant),
  })
  const [serverError, setServerError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [saving, setSaving] = useState(false)

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
      onOpenChange(false)
    } catch (error) {
      const message = apiErrorMessage(error)
      setServerError(error instanceof ApiRequestError && error.status === 409
        ? 'ข้อมูลเปลี่ยนแปลงบนเซิร์ฟเวอร์ กรุณาตรวจสอบรูปแบบสินค้าอีกครั้ง'
        : message)
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
                <VariantInput id="variant-sku" label="SKU" error={fieldError('sku')} {...form.register('sku')} readOnly={isEdit} required={!isEdit} />
                <VariantInput id="variant-name" label="ชื่อรูปแบบ" error={fieldError('name')} {...form.register('name')} required />
                <VariantInput id="variant-unit" label="หน่วย" error={fieldError('unit')} {...form.register('unit')} required />
                <VariantInput id="variant-price" label="ราคา (บาท)" error={fieldError('priceBaht')} inputMode="decimal" placeholder="0.00" {...form.register('priceBaht')} required />
                <VariantInput id="variant-order" label="ลำดับการแสดง" error={fieldError('displayOrder')} type="number" {...form.register('displayOrder', { valueAsNumber: true })} />
                <VariantInput id="variant-shelf-life" label="อายุคงเหลือขั้นต่ำ (วัน)" error={fieldError('minRemainingShelfLifeDays')} type="number" {...form.register('minRemainingShelfLifeDays', { valueAsNumber: true })} />
              </div>
              {isEdit && <p className="text-sm text-muted-foreground">SKU {variant?.sku} เปลี่ยนไม่ได้</p>}
              <FieldSet>
                <FieldLegend variant="label">การขาย</FieldLegend>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="variant-sales-enabled">
                    <Controller
                      control={form.control}
                      name="salesEnabled"
                      render={({ field }) => <Checkbox checked={field.value} id="variant-sales-enabled" onCheckedChange={field.onChange} />}
                    />
                    เปิดขายรูปแบบนี้
                  </FieldLabel>
                </Field>
                <FieldDescription>เมื่อปิดขาย รูปแบบสินค้าจะยังอยู่ในแค็ตตาล็อกสำหรับการจัดการสต็อก</FieldDescription>
              </FieldSet>
            </FieldGroup>
            {serverError && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{serverError}</p>}
            <DialogFooter>
              <Button disabled={saving} onClick={requestClose} type="button" variant="outline">ยกเลิก</Button>
              <Button disabled={saving} type="submit">{saving ? 'กำลังบันทึก...' : 'บันทึกรูปแบบสินค้า'}</Button>
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
