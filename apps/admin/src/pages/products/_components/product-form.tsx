import { useEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Textarea } from '@workspace/ui/components/textarea'
import { toast } from '@workspace/ui/components/toast'
import { Link } from 'react-router'
import { cn } from '@workspace/ui/lib/utils'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { catalogApi, type ProductDetail } from '@/lib/catalog/api'
import {
  defaultVatTreatment,
  productCreateSchema,
  productEditSchema,
  toProductCreateInput,
  toProductUpdateInput,
  type ProductCreateValues,
  type ProductEditValues,
  vatItems,
} from '@/lib/catalog/forms'
import { catalogKeys, invalidateCatalog, productsQuery } from '@/lib/catalog/queries'

const emptyValues: ProductCreateValues = {
  slug: '',
  name: '',
  category: 'fresh',
  vatTreatment: 'exempt',
  englishName: '',
  description: '',
  originStory: '',
  storageInstructions: '',
  imageUrl: '',
  imageAlt: '',
}

type ProductFormProps =
  | { mode: 'create'; onCreated: (productId: string) => void; onDirtyChange: (dirty: boolean) => void }
  | { mode: 'edit'; product: ProductDetail; readOnlyReason?: string; onDirtyChange: (dirty: boolean) => void }

function errorForCreate(error: unknown): string {
  const message = apiErrorMessage(error)
  if (isAmbiguousCreateFailure(error)) {
    return `${message} หากไม่แน่ใจว่าบันทึกสำเร็จหรือไม่ ให้ตรวจสอบรายการสินค้าก่อนสร้างใหม่`
  }
  return message
}

function isAmbiguousCreateFailure(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && (error.status === 0 || error.status >= 500)
}

function fromProduct(product: ProductDetail): ProductEditValues {
  return {
    slug: product.slug,
    name: product.name,
    category: product.category,
    vatTreatment: product.vatTreatment,
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
  const vatTouched = useRef(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [createdProductId, setCreatedProductId] = useState<string | null>(null)
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const [createRecoveryStatus, setCreateRecoveryStatus] = useState<'idle' | 'checking' | 'ready' | 'failed'>('idle')
  const onCreated = props.mode === 'create' ? props.onCreated : null
  const onDirtyChange = props.onDirtyChange
  const editProduct = props.mode === 'edit' ? props.product : null
  const readOnlyReason = props.mode === 'edit' ? props.readOnlyReason : undefined
  const watchedImageUrl = useWatch({ control: form.control, name: 'imageUrl' })
  const watchedImageAlt = useWatch({ control: form.control, name: 'imageAlt' })

  useEffect(() => {
    if (createdProductId) onCreated?.(createdProductId)
  }, [createdProductId, onCreated])

  useEffect(() => {
    onDirtyChange(form.formState.isDirty)
  }, [form.formState.isDirty, onDirtyChange])

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  // Pick up server changes (another tab, a variant save) unless the staff member has unsaved edits.
  useEffect(() => {
    if (editProduct && !form.formState.isDirty) form.reset(fromProduct(editProduct))
  }, [editProduct, form])

  const refreshCatalogAfterUncertainCreate = async () => {
    setCreateRecoveryStatus('checking')
    await queryClient.invalidateQueries({ queryKey: catalogKeys.lists(), refetchType: 'none' })
    try {
      await queryClient.fetchQuery({ ...productsQuery({ limit: 25 }), staleTime: 0 })
      setCreateRecoveryStatus('ready')
    } catch {
      setCreateRecoveryStatus('failed')
    }
  }

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
      }
    } catch (error) {
      setServerError(props.mode === 'create' ? errorForCreate(error) : apiErrorMessage(error))
      if (props.mode === 'create' && isAmbiguousCreateFailure(error)) {
        setServerError(`${errorForCreate(error)} ระบบจะไม่ส่งคำขอสร้างซ้ำโดยอัตโนมัติ`)
        await refreshCatalogAfterUncertainCreate()
      }
      if (props.mode === 'edit' && error instanceof ApiRequestError && error.status === 409) {
        await invalidateCatalog(queryClient, props.product.id)
      }
    }
  })

  const errors = form.formState.errors
  const pending = form.formState.isSubmitting
  const locked = pending || Boolean(readOnlyReason)
  const dirty = form.formState.isDirty
  const imageFailed = Boolean(watchedImageUrl && failedImageUrl === watchedImageUrl)
  const showActionBar = isCreate || dirty || pending || Boolean(serverError)

  return (
    <form aria-label={isCreate ? 'ข้อมูลสินค้าใหม่' : 'ข้อมูลสินค้า'} className="flex flex-col gap-6" noValidate onSubmit={onSubmit}>
      {readOnlyReason && <p className="rounded-surface border bg-muted/50 px-4 py-3 text-sm text-muted-foreground" role="status">{readOnlyReason}</p>}

      <Card aria-labelledby="product-basics-title" role="region">
        <CardHeader>
          <CardTitle><h2 id="product-basics-title">ข้อมูลหลัก</h2></CardTitle>
          <CardDescription>ชื่อ หมวดหมู่ และภาษีที่ใช้คำนวณราคา</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-5 md:grid-cols-2">
              <FormInput disabled={locked} id="product-name" label="ชื่อสินค้า" error={errors.name?.message} {...form.register('name')} required />
              <FormInput disabled={locked} id="product-english-name" label="ชื่อภาษาอังกฤษ" error={errors.englishName?.message} {...form.register('englishName')} />
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <Field data-invalid={Boolean(errors.category)}>
                <FieldLabel htmlFor="product-category">หมวดหมู่</FieldLabel>
                <Controller
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <Select disabled={locked} items={[{ label: 'สินค้าสด', value: 'fresh' }, { label: 'สินค้าแปรรูป', value: 'processed' }]} onValueChange={(value) => {
                      field.onChange(value)
                      if (isCreate && !vatTouched.current && (value === 'fresh' || value === 'processed')) {
                        form.setValue('vatTreatment', defaultVatTreatment(value))
                      }
                    }} value={field.value}>
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
              <Field data-invalid={Boolean(errors.vatTreatment)}>
                <FieldLabel htmlFor="product-vat-treatment">ภาษีมูลค่าเพิ่ม</FieldLabel>
                <Controller
                  control={form.control}
                  name="vatTreatment"
                  render={({ field }) => (
                    <Select disabled={locked} items={vatItems} onValueChange={(value) => {
                      vatTouched.current = true
                      field.onChange(value)
                    }} value={field.value}>
                      <SelectTrigger aria-describedby={errors.vatTreatment ? 'product-vat-treatment-error' : undefined} aria-invalid={Boolean(errors.vatTreatment)} aria-required="true" id="product-vat-treatment">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent><SelectGroup>
                        {vatItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                      </SelectGroup></SelectContent>
                    </Select>
                  )}
                />
                <FieldError id="product-vat-treatment-error">{errors.vatTreatment?.message}</FieldError>
              </Field>
            </div>
            <FormInput
              id="product-slug"
              label="ชื่อ URL สินค้า"
              description={isCreate ? 'ใช้ตัวอักษรภาษาอังกฤษตัวเล็ก ตัวเลข และขีดกลาง เปลี่ยนไม่ได้หลังสร้าง' : 'ชื่อ URL เปลี่ยนไม่ได้หลังสร้างสินค้า'}
              error={errors.slug?.message}
              disabled={pending}
              className={cn(!isCreate && 'bg-muted/50 font-mono text-muted-foreground')}
              {...form.register('slug')}
              required={isCreate}
              readOnly={!isCreate || Boolean(readOnlyReason)}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card aria-labelledby="product-image-title" role="region">
        <CardHeader>
          <CardTitle><h2 id="product-image-title">รูปภาพ</h2></CardTitle>
          <CardDescription>วาง URL รูปภาพ HTTPS ที่เปิดดูได้ ยังไม่มีระบบอัปโหลดรูป</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
          {watchedImageUrl && !imageFailed
            ? <img alt={watchedImageAlt || 'ตัวอย่างรูปสินค้า'} className="aspect-square w-full rounded-field border bg-muted object-cover" onError={() => setFailedImageUrl(watchedImageUrl)} src={watchedImageUrl} />
            : <div aria-label={imageFailed ? 'โหลดรูปภาพไม่ได้' : 'ไม่มีรูปภาพ'} className="grid aspect-square w-full place-items-center rounded-field border border-dashed bg-muted/50 p-3 text-center text-xs text-muted-foreground" role="img">{imageFailed ? 'โหลดรูปภาพไม่ได้' : 'ยังไม่มีรูปสินค้า'}</div>}
          <FieldGroup>
            <FormInput disabled={locked} id="product-image-url" label="URL รูปสินค้า HTTPS" error={errors.imageUrl?.message} inputMode="url" placeholder="https://" {...form.register('imageUrl')} />
            <FormInput disabled={locked} id="product-image-alt" label="คำอธิบายรูปภาพ" description="อธิบายสิ่งสำคัญในภาพสำหรับผู้ใช้โปรแกรมอ่านหน้าจอ" error={errors.imageAlt?.message} {...form.register('imageAlt')} />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card aria-labelledby="product-content-title" role="region">
        <CardHeader>
          <CardTitle><h2 id="product-content-title">เนื้อหาสำหรับลูกค้า</h2></CardTitle>
          <CardDescription>แสดงในหน้าสินค้าของหน้าร้าน</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <FormTextarea disabled={locked} id="product-description" label="คำอธิบาย" description="ข้อมูลนี้จำเป็นก่อนเผยแพร่สินค้า" error={errors.description?.message} {...form.register('description')} />
            <FormTextarea disabled={locked} id="product-origin-story" label="เรื่องราวจากสวน" error={errors.originStory?.message} {...form.register('originStory')} />
            <FormTextarea disabled={locked} id="product-storage-instructions" label="วิธีเก็บรักษา" error={errors.storageInstructions?.message} {...form.register('storageInstructions')} />
          </FieldGroup>
        </CardContent>
      </Card>

      {showActionBar && !readOnlyReason && <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-surface border bg-card/95 px-4 py-3 shadow-lg backdrop-blur supports-backdrop-filter:bg-card/80">
        {serverError && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{serverError}</p>}
        {createRecoveryStatus === 'checking' && <p className="text-sm text-muted-foreground" role="status">กำลังตรวจสอบรายการสินค้าล่าสุด...</p>}
        {createRecoveryStatus === 'failed' && <p className="text-sm text-destructive" role="alert">อัปเดตรายการสินค้าไม่สำเร็จ กรุณาตรวจสอบรายการก่อนสร้างสินค้าอีกครั้ง</p>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground" role="status">
            {isCreate ? 'สินค้าจะถูกสร้างเป็นฉบับร่าง แล้วเพิ่มรูปแบบสินค้าได้ในขั้นถัดไป' : pending ? 'กำลังบันทึก...' : 'มีการแก้ไขที่ยังไม่บันทึก'}
          </p>
          <div className="flex flex-wrap gap-2">
            {createRecoveryStatus === 'ready' && <Link className={buttonVariants({ variant: 'outline' })} to="/products">ตรวจสอบรายการสินค้า</Link>}
            {createRecoveryStatus === 'failed' && <Button disabled={pending} onClick={() => void refreshCatalogAfterUncertainCreate()} type="button" variant="outline">ลองโหลดรายการสินค้าอีกครั้ง</Button>}
            {editProduct && <Button disabled={pending} onClick={() => {
              form.reset(fromProduct(editProduct))
              setServerError(null)
            }} type="button" variant="ghost">ทิ้งการแก้ไข</Button>}
            <Button disabled={pending || (isCreate && createRecoveryStatus !== 'idle')} type="submit">{pending ? 'กำลังบันทึก...' : isCreate ? 'สร้างสินค้า' : 'บันทึกสินค้า'}</Button>
          </div>
        </div>
      </div>}
    </form>
  )
}

export function FormInput({ id, label, description, error, ...props }: {
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

export function FormTextarea({ id, label, description, error, ...props }: {
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
