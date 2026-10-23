import { useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Textarea } from '@workspace/ui/components/textarea'
import { toast } from '@workspace/ui/components/toast'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import type { DiscountDetail } from '@/lib/discounts/api'
import { categoryLabels, discountKindLabels } from '@/lib/discounts/labels'
import { useCreateDiscountMutation, useDeleteDiscountMutation, useUpdateDiscountMutation } from '@/lib/discounts/queries'
import {
  discountFormSchema,
  discountToFormValues,
  emptyDiscountValues,
  randomDiscountCode,
  toDiscountInput,
  toDiscountUpdateInput,
  type DiscountFormValues,
  type DiscountKind,
  type Eligibility,
} from '@/lib/discounts/schema'
import { ConfirmActionDialog } from '@/pages/products/_components/product-actions'
import { ProductPicker } from './product-picker'

function TextField({ id, label, description, error, ...props }: {
  id: string
  label: string
  description?: string
  error?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input aria-describedby={[description ? `${id}-description` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined} aria-invalid={Boolean(error)} id={id} {...props} />
      {description && <FieldDescription id={`${id}-description`}>{description}</FieldDescription>}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>{title}</h2></CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent><FieldGroup>{children}</FieldGroup></CardContent>
    </Card>
  )
}

function RadioOption({ label, disabled, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input className="size-4 accent-primary" disabled={disabled} type="radio" {...props} />
      <span>{label}</span>
    </label>
  )
}

const kinds: DiscountKind[] = ['percent', 'fixed', 'free_shipping']
const eligibilityOptions: { value: Eligibility; label: string }[] = [
  { value: 'all', label: 'ทุกสินค้า' },
  { value: 'categories', label: 'เฉพาะหมวดหมู่ที่เลือก' },
  { value: 'products', label: 'เฉพาะสินค้าที่เลือก' },
]

export function DiscountForm({ discount, canUpdate, onReload }: {
  discount: DiscountDetail | null
  canUpdate: boolean
  onReload: () => void
}) {
  const navigate = useNavigate()
  const create = useCreateDiscountMutation()
  const update = useUpdateDiscountMutation(discount?.id ?? '')
  const remove = useDeleteDiscountMutation()
  const [serverError, setServerError] = useState<{ message: string; conflict: boolean } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const form = useForm<DiscountFormValues>({
    resolver: zodResolver(discountFormSchema),
    defaultValues: discount ? discountToFormValues(discount) : emptyDiscountValues,
  })
  const kind = useWatch({ control: form.control, name: 'kind' })
  const eligibility = useWatch({ control: form.control, name: 'eligibility' })
  const errors = form.formState.errors
  const locked = discount?.locked ?? false
  const readOnly = !canUpdate
  const pending = form.formState.isSubmitting || create.isPending || update.isPending

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    try {
      if (discount) {
        await update.mutateAsync(toDiscountUpdateInput(values, discount.version))
        toast.add({ title: 'บันทึกโค้ดส่วนลดแล้ว', type: 'success' })
      } else {
        const created = await create.mutateAsync(toDiscountInput(values))
        toast.add({ title: 'สร้างโค้ดส่วนลดแล้ว', type: 'success' })
        navigate(`/marketing/discounts/${created.id}`, { replace: true })
      }
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.code : ''
      if (code === 'DISCOUNT_CODE_TAKEN') form.setError('code', { message: apiErrorMessage(error) }, { shouldFocus: true })
      setServerError({ message: apiErrorMessage(error), conflict: code === 'DISCOUNT_VERSION_CONFLICT' })
    }
  })

  async function confirmDelete() {
    if (!discount) return
    try {
      await remove.mutateAsync(discount.id)
      toast.add({ title: 'ลบโค้ดส่วนลดแล้ว', type: 'success' })
      navigate('/marketing/discounts', { replace: true })
    } catch (error) {
      setConfirmingDelete(false)
      setServerError({ message: apiErrorMessage(error), conflict: false })
    }
  }

  return (
    <form aria-label="ข้อมูลโค้ดส่วนลด" className="flex flex-col gap-6" noValidate onSubmit={onSubmit}>
      {readOnly && <p className="rounded-surface border bg-muted/50 px-4 py-3 text-sm text-muted-foreground" role="status">บัญชีนี้ดูโค้ดส่วนลดได้อย่างเดียว ไม่มีสิทธิ์แก้ไข</p>}

      <Section title="โค้ด" description="รหัสที่ลูกค้ากรอกตอนชำระเงิน และชื่อที่ใช้ภายในร้าน">
        <Field data-invalid={Boolean(errors.code)}>
          <FieldLabel htmlFor="discount-code">รหัสโค้ด</FieldLabel>
          <div className="flex gap-2">
            <Input aria-describedby="discount-code-description discount-code-error" aria-invalid={Boolean(errors.code)} autoCapitalize="characters" autoComplete="off" className="font-mono uppercase" disabled={readOnly || locked} id="discount-code" {...form.register('code')} />
            {!locked && !readOnly && <Button onClick={() => form.setValue('code', randomDiscountCode(), { shouldDirty: true, shouldValidate: form.formState.isSubmitted })} type="button" variant="outline">สุ่มโค้ด</Button>}
          </div>
          <FieldDescription id="discount-code-description">
            {locked
              ? 'เปลี่ยนรหัสโค้ดไม่ได้ เพราะมีคำสั่งซื้อใช้โค้ดนี้แล้ว ถ้าไม่ต้องการให้ใช้ต่อ ให้ปิดใช้งานแทน'
              : 'ตัวอักษร A-Z ตัวเลข และขีดกลาง 3-32 ตัว ไม่สนใจตัวพิมพ์เล็กหรือใหญ่ ลูกค้ากรอกได้ทั้งสองแบบ'}
          </FieldDescription>
          <FieldError id="discount-code-error">{errors.code?.message}</FieldError>
        </Field>
        <TextField description="ชื่อสำหรับทีมงานเท่านั้น ลูกค้าไม่เห็น" disabled={readOnly} error={errors.name?.message} id="discount-name" label="ชื่อโค้ด" maxLength={100} {...form.register('name')} />
      </Section>

      <Section title="ประเภทส่วนลด" description="เลือกว่าโค้ดนี้ลดราคาสินค้าหรือค่าจัดส่ง">
        <div aria-label="ประเภทส่วนลด" className="flex flex-wrap gap-x-6 gap-y-2" role="radiogroup">
          {kinds.map((value) => <RadioOption disabled={readOnly || locked} key={value} label={discountKindLabels[value]} value={value} {...form.register('kind')} />)}
        </div>
        {locked && <p className="text-sm text-muted-foreground">เปลี่ยนประเภทไม่ได้ เพราะมีคำสั่งซื้อใช้โค้ดนี้แล้ว</p>}
        {kind === 'percent' && <div className="grid gap-5 md:grid-cols-2">
          <TextField description="จำนวนเต็ม 1-100" disabled={readOnly} error={errors.percentOff?.message} id="discount-percent" inputMode="numeric" label="ลดกี่เปอร์เซ็นต์" {...form.register('percentOff')} />
          <TextField description="เว้นว่างถ้าไม่จำกัดยอดลด" disabled={readOnly} error={errors.maxDiscountBaht?.message} id="discount-max" inputMode="decimal" label="ลดสูงสุด (บาท)" {...form.register('maxDiscountBaht')} />
        </div>}
        {kind === 'fixed' && <TextField description="ลดจากยอดสินค้า แต่ไม่เกินยอดสินค้าที่ร่วมรายการ" disabled={readOnly} error={errors.amountOffBaht?.message} id="discount-amount" inputMode="decimal" label="ลดกี่บาท" {...form.register('amountOffBaht')} />}
        {kind === 'free_shipping' && <p className="text-sm text-muted-foreground">ลูกค้าไม่ต้องจ่ายค่าจัดส่งเมื่อเข้าเงื่อนไข</p>}
      </Section>

      <Section title="เงื่อนไขการใช้" description="ไม่ต้องกรอกทุกช่อง เว้นว่างหมายถึงไม่จำกัด">
        <div className="grid gap-5 md:grid-cols-2">
          <TextField description="เว้นว่างถ้าไม่จำกัด คิดจากยอดสินค้าก่อนหักส่วนลด" disabled={readOnly} error={errors.minSubtotalBaht?.message} id="discount-min-subtotal" inputMode="decimal" label="ยอดซื้อขั้นต่ำ (บาท)" {...form.register('minSubtotalBaht')} />
          <TextField description="เว้นว่างถ้าไม่จำกัด" disabled={readOnly} error={errors.minQuantity?.message} id="discount-min-quantity" inputMode="numeric" label="จำนวนชิ้นขั้นต่ำ" {...form.register('minQuantity')} />
        </div>
        <Field data-invalid={Boolean(errors.categories || errors.productIds)}>
          <FieldLabel id="discount-eligibility-label">สินค้าที่ร่วมรายการ</FieldLabel>
          <div aria-labelledby="discount-eligibility-label" className="flex flex-wrap gap-x-6 gap-y-2" role="radiogroup">
            {eligibilityOptions.map((option) => <RadioOption disabled={readOnly} key={option.value} label={option.label} value={option.value} {...form.register('eligibility')} />)}
          </div>
          {eligibility === 'categories' && <Controller control={form.control} name="categories" render={({ field }) => (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {Object.entries(categoryLabels).map(([value, label]) => (
                <label className="flex items-center gap-2 text-sm" key={value}>
                  <Checkbox aria-label={label} checked={field.value.includes(value)} disabled={readOnly} onCheckedChange={(checked) => field.onChange(checked ? [...field.value, value] : field.value.filter((item) => item !== value))} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          )} />}
          {eligibility === 'products' && <Controller control={form.control} name="productIds" render={({ field }) => (
            <ProductPicker disabled={readOnly} invalid={Boolean(errors.productIds)} onChange={field.onChange} value={field.value} />
          )} />}
          <FieldDescription>ส่วนลดคิดจากสินค้าที่ร่วมรายการเท่านั้น</FieldDescription>
          <FieldError>{errors.categories?.message ?? errors.productIds?.message}</FieldError>
        </Field>
      </Section>

      <Section title="ระยะเวลาและจำนวนครั้ง" description="เวลาทั้งหมดเป็นเวลาไทย (UTC+7)">
        <div className="grid gap-5 md:grid-cols-2">
          <TextField description="เว้นว่างถ้าเริ่มใช้ได้ทันที" disabled={readOnly} error={errors.startsAt?.message} id="discount-starts-at" label="เริ่มใช้ได้ (เวลาไทย)" type="datetime-local" {...form.register('startsAt')} />
          <TextField description="เว้นว่างถ้าไม่มีวันหมดอายุ" disabled={readOnly} error={errors.endsAt?.message} id="discount-ends-at" label="หมดอายุ (เวลาไทย)" type="datetime-local" {...form.register('endsAt')} />
          <TextField description="เว้นว่างถ้าไม่จำกัด นับทุกคำสั่งซื้อที่ไม่ถูกยกเลิก" disabled={readOnly} error={errors.usageLimit?.message} id="discount-usage-limit" inputMode="numeric" label="ใช้ได้ทั้งหมดกี่ครั้ง" {...form.register('usageLimit')} />
          <TextField description="เว้นว่างถ้าไม่จำกัด" disabled={readOnly} error={errors.perCustomerLimit?.message} id="discount-per-customer" inputMode="numeric" label="ใช้ได้ต่อลูกค้ากี่ครั้ง" {...form.register('perCustomerLimit')} />
        </div>
      </Section>

      <Section title="ผู้ใช้โค้ด" description="จำกัดว่าใครใช้โค้ดนี้ได้">
        <Field data-invalid={Boolean(errors.allowedEmails)}>
          <FieldLabel htmlFor="discount-emails">อีเมลที่ใช้ได้</FieldLabel>
          <Textarea aria-describedby="discount-emails-description discount-emails-error" aria-invalid={Boolean(errors.allowedEmails)} className="min-h-24 font-mono" disabled={readOnly} id="discount-emails" {...form.register('allowedEmails')} />
          <FieldDescription id="discount-emails-description">หนึ่งอีเมลต่อบรรทัด เว้นว่างถ้าทุกคนใช้ได้ ถ้ากรอก โค้ดนี้จะเป็นโค้ดส่วนตัวที่ไม่บอกใบ้ว่ามีอยู่จริงกับคนอื่น</FieldDescription>
          <FieldError id="discount-emails-error">{errors.allowedEmails?.message}</FieldError>
        </Field>
        <Controller control={form.control} name="firstOrderOnly" render={({ field }) => (
          <Field orientation="horizontal">
            <Checkbox checked={field.value} disabled={readOnly} id="discount-first-order" onCheckedChange={field.onChange} />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="discount-first-order">ใช้ได้เฉพาะคำสั่งซื้อแรกของลูกค้า</FieldLabel>
              <FieldDescription>ลูกค้าที่เคยสั่งซื้อสำเร็จแล้วจะใช้ไม่ได้</FieldDescription>
            </div>
          </Field>
        )} />
        <Controller control={form.control} name="active" render={({ field }) => (
          <Field orientation="horizontal">
            <Checkbox checked={field.value} disabled={readOnly} id="discount-active" onCheckedChange={field.onChange} />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="discount-active">เปิดใช้งานโค้ดนี้</FieldLabel>
              <FieldDescription>ปิดไว้เพื่อหยุดใช้ชั่วคราวโดยไม่ลบโค้ด</FieldDescription>
            </div>
          </Field>
        )} />
      </Section>

      {serverError && <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>{serverError.message}</span>
          {serverError.conflict && <Button onClick={onReload} size="sm" type="button" variant="outline">โหลดใหม่</Button>}
        </AlertDescription>
      </Alert>}

      {!readOnly && <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} type="submit">{pending ? 'กำลังบันทึก...' : 'บันทึกโค้ด'}</Button>
        {discount && !locked && <Button disabled={pending} onClick={() => setConfirmingDelete(true)} type="button" variant="destructive">ลบโค้ด</Button>}
        {discount && locked && <p className="text-sm text-muted-foreground">ลบไม่ได้เพราะมีคำสั่งซื้อใช้โค้ดนี้แล้ว ให้ปิดใช้งานแทน</p>}
      </div>}

      <ConfirmActionDialog
        confirmLabel="ยืนยันลบโค้ด"
        confirmVariant="destructive"
        description="โค้ดนี้ยังไม่เคยถูกใช้ในคำสั่งซื้อ การลบกู้คืนไม่ได้"
        onConfirm={() => void confirmDelete()}
        onOpenChange={(open) => !open && !remove.isPending && setConfirmingDelete(false)}
        open={confirmingDelete}
        pending={remove.isPending}
        title="ลบโค้ดส่วนลดนี้?"
      />
    </form>
  )
}
