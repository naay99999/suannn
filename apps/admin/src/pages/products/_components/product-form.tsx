import { useEffect, useState } from 'react'
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Textarea } from '@workspace/ui/components/textarea'
import { toast } from '@workspace/ui/components/toast'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { catalogApi, type ProductDetail } from '@/lib/catalog/api'
import {
  productCreateSchema,
  productEditSchema,
  toProductCreateInput,
  toProductUpdateInput,
  type ProductCreateValues,
  type ProductEditValues,
} from '@/lib/catalog/forms'
import { invalidateCatalog } from '@/lib/catalog/queries'
import { ConfirmActionDialog } from './product-actions'

const emptyValues: ProductCreateValues = {
  slug: '',
  name: '',
  category: 'fresh',
  englishName: '',
  description: '',
  originStory: '',
  storageInstructions: '',
  imageUrl: '',
  imageAlt: '',
}

type ProductFormProps =
  | { mode: 'create'; onCreated: (productId: string) => void; onDirtyChange: (dirty: boolean) => void }
  | { mode: 'edit'; product: ProductDetail; onCancel: () => void; onSaved: () => void; onDirtyChange: (dirty: boolean) => void }

function errorForCreate(error: unknown): string {
  const message = apiErrorMessage(error)
  if (error instanceof ApiRequestError && error.status === 0) {
    return `${message} หากไม่แน่ใจว่าบันทึกสำเร็จหรือไม่ ให้ตรวจสอบรายการสินค้าก่อนสร้างใหม่`
  }
  return message
}

function fromProduct(product: ProductDetail): ProductEditValues {
  return {
    slug: product.slug,
    name: product.name,
    category: product.category,
    englishName: product.englishName ?? '',
    description: product.description ?? '',
    originStory: product.originStory ?? '',
    storageInstructions: product.storageInstructions ?? '',
    imageUrl: product.imageUrl ?? '',
    imageAlt: product.imageAlt ?? '',
  }
}

export function ProductForm(props: ProductFormProps) {
  const queryClient = useQueryClient()
  const isCreate = props.mode === 'create'
  const schema = isCreate ? productCreateSchema : productEditSchema
  const form = useForm<ProductCreateValues | ProductEditValues>({
    resolver: zodResolver(schema),
    defaultValues: isCreate ? emptyValues : fromProduct(props.product),
  })
  const [serverError, setServerError] = useState<string | null>(null)
  const [createdProductId, setCreatedProductId] = useState<string | null>(null)
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const onCreated = props.mode === 'create' ? props.onCreated : null
  const onDirtyChange = props.onDirtyChange
  const watchedImageUrl = useWatch({ control: form.control, name: 'imageUrl' })
  const watchedImageAlt = useWatch({ control: form.control, name: 'imageAlt' })

  useEffect(() => {
    if (createdProductId) onCreated?.(createdProductId)
  }, [createdProductId, onCreated])

  useEffect(() => {
    onDirtyChange(form.formState.isDirty)
  }, [form.formState.isDirty, onDirtyChange])

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    try {
      if (props.mode === 'create') {
        const created = await catalogApi.create(toProductCreateInput(values as ProductCreateValues))
        await invalidateCatalog(queryClient, created.id)
        toast.add({ title: 'สร้างสินค้าแล้ว', type: 'success' })
        form.reset(emptyValues)
        onDirtyChange(false)
        setCreatedProductId(created.id)
      } else {
        await catalogApi.update(props.product.id, toProductUpdateInput(values as ProductEditValues))
        await invalidateCatalog(queryClient, props.product.id)
        toast.add({ title: 'บันทึกข้อมูลสินค้าแล้ว', type: 'success' })
        form.reset(values)
        onDirtyChange(false)
        props.onSaved()
      }
    } catch (error) {
      setServerError(props.mode === 'create' ? errorForCreate(error) : apiErrorMessage(error))
      if (props.mode === 'edit' && error instanceof ApiRequestError && error.status === 409) {
        await invalidateCatalog(queryClient, props.product.id)
      }
    }
  })

  const errors = form.formState.errors
  const pending = form.formState.isSubmitting
  const imageFailed = Boolean(watchedImageUrl && failedImageUrl === watchedImageUrl)

  return (
    <section className="flex flex-col gap-5 rounded-lg border p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{isCreate ? 'ข้อมูลสินค้าใหม่' : 'แก้ไขข้อมูลสินค้า'}</h2>
        <p className="text-sm text-muted-foreground">ข้อมูลที่จำเป็นสำหรับจัดการสินค้าในแค็ตตาล็อก</p>
      </div>
      <form className="flex flex-col gap-6" noValidate onSubmit={onSubmit}>
        <FieldGroup>
          <div className="grid gap-5 md:grid-cols-2">
            <FormInput
              id="product-slug"
              label="ชื่อ URL สินค้า"
              description={isCreate ? 'ใช้ตัวอักษรภาษาอังกฤษตัวเล็ก ตัวเลข และขีดกลาง' : 'ชื่อ URL เปลี่ยนไม่ได้หลังสร้างสินค้า'}
              error={errors.slug?.message}
              {...form.register('slug')}
              required={isCreate}
              readOnly={!isCreate}
            />
            <FormInput id="product-name" label="ชื่อสินค้า" error={errors.name?.message} {...form.register('name')} required />
          </div>
          <Field data-invalid={Boolean(errors.category)}>
            <FieldLabel htmlFor="product-category">หมวดหมู่</FieldLabel>
            <Controller
              control={form.control}
              name="category"
              render={({ field }) => (
                <Select items={[{ label: 'สินค้าสด', value: 'fresh' }, { label: 'สินค้าแปรรูป', value: 'processed' }]} onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger aria-describedby={errors.category ? 'product-category-error' : undefined} aria-invalid={Boolean(errors.category)} aria-required="true" id="product-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value="fresh">สินค้าสด</SelectItem>
                    <SelectItem value="processed">สินค้าแปรรูป</SelectItem>
                  </SelectGroup></SelectContent>
                </Select>
              )}
            />
            <FieldError id="product-category-error">{errors.category?.message}</FieldError>
          </Field>
          <FormInput id="product-english-name" label="ชื่อภาษาอังกฤษ" error={errors.englishName?.message} {...form.register('englishName')} />
          <FormTextarea id="product-description" label="คำอธิบาย" description="ข้อมูลนี้จำเป็นก่อนเผยแพร่สินค้า" error={errors.description?.message} {...form.register('description')} />
          <FormTextarea id="product-origin-story" label="เรื่องราวจากสวน" error={errors.originStory?.message} {...form.register('originStory')} />
          <FormTextarea id="product-storage-instructions" label="วิธีเก็บรักษา" error={errors.storageInstructions?.message} {...form.register('storageInstructions')} />
          <div className="grid gap-5 md:grid-cols-2">
            <FormInput id="product-image-url" label="URL รูปสินค้า HTTPS" description="วาง URL รูปภาพ HTTPS ที่เปิดดูได้ ไม่มีระบบอัปโหลดรูป" error={errors.imageUrl?.message} {...form.register('imageUrl')} />
            <FormInput id="product-image-alt" label="คำอธิบายรูปภาพ" description="อธิบายสิ่งสำคัญในภาพสำหรับผู้ใช้โปรแกรมอ่านหน้าจอ" error={errors.imageAlt?.message} {...form.register('imageAlt')} />
          </div>
        </FieldGroup>

        <div className="flex flex-col gap-3 rounded-md border p-4">
          <h3 className="font-medium">ตัวอย่างรูปสินค้า</h3>
          {watchedImageUrl && !imageFailed
            ? <img alt={watchedImageAlt || ''} className="max-h-64 w-full rounded-md border object-contain" onError={() => setFailedImageUrl(watchedImageUrl)} src={watchedImageUrl} />
            : <div aria-label="ไม่มีรูปภาพ" className="grid min-h-32 place-items-center rounded-md bg-muted text-sm text-muted-foreground" role="img">{imageFailed ? 'โหลดรูปภาพไม่ได้' : 'ยังไม่มีรูปสินค้า'}</div>}
        </div>

        {serverError && <div aria-live="assertive" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{serverError}</div>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} type="submit">{pending ? 'กำลังบันทึก...' : isCreate ? 'สร้างสินค้า' : 'บันทึกสินค้า'}</Button>
          {props.mode === 'edit' && <Button disabled={pending} onClick={() => form.formState.isDirty ? setConfirmCancel(true) : props.onCancel()} type="button" variant="outline">ยกเลิกการแก้ไข</Button>}
        </div>
      </form>
      {props.mode === 'edit' && <ConfirmActionDialog
        open={confirmCancel}
        title="ทิ้งการแก้ไขสินค้า?"
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

function FormInput({ id, label, description, error, ...props }: {
  id: string
  label: string
  description?: string
  error?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input aria-describedby={[description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined} aria-invalid={Boolean(error)} id={id} {...props} />
      {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  )
}

function FormTextarea({ id, label, description, error, ...props }: {
  id: string
  label: string
  description?: string
  error?: string
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea aria-describedby={[description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined} aria-invalid={Boolean(error)} id={id} rows={4} {...props} />
      {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  )
}
