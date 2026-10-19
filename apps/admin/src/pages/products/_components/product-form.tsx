import { useEffect, useId, useRef, useState } from 'react'
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Badge } from '@workspace/ui/components/badge'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Textarea } from '@workspace/ui/components/textarea'
import { toast } from '@workspace/ui/components/toast'
import { cn } from '@workspace/ui/lib/utils'
import { MediaGalleryField } from '@/components/media/media-gallery-field'
import { toMediaImageValue } from '@/lib/media/value'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { catalogApi, type ProductDetail } from '@/lib/catalog/api'
import {
  defaultVatTreatment,
  productCreateSchema,
  productEditSchema,
  productStatusItems,
  publicationChecks,
  toProductCreateInput,
  toProductUpdateInput,
  type ProductCreateValues,
  type ProductEditValues,
  type ProductStatusValue,
  vatItems,
} from '@/lib/catalog/forms'
import { catalogKeys, invalidateCatalog, productsQuery } from '@/lib/catalog/queries'
import { ConfirmActionDialog, PublicationChecklist } from './product-actions'

const emptyValues: ProductCreateValues = {
  slug: '',
  name: '',
  category: 'fresh',
  vatTreatment: 'exempt',
  englishName: '',
  description: '',
  originStory: '',
  storageInstructions: '',
  images: [],
}

type StatusTransition = 'publish' | 'unpublish' | 'archive'

const transitionCopy: Record<StatusTransition, { title: string; description: string; confirm: string; success: string }> = {
  publish: {
    title: 'ยืนยันเผยแพร่สินค้า',
    description: 'สินค้าจะปรากฏในแค็ตตาล็อกที่ลูกค้าเลือกซื้อได้',
    confirm: 'ยืนยันเผยแพร่สินค้า',
    success: 'เผยแพร่สินค้าแล้ว',
  },
  unpublish: {
    title: 'ยืนยันนำสินค้าออกจากการเผยแพร่',
    description: 'สินค้าจะกลับเป็นฉบับร่างและไม่แสดงให้ลูกค้าเลือกซื้อ',
    confirm: 'ยืนยันนำออกจากการเผยแพร่',
    success: 'นำสินค้าออกจากการเผยแพร่แล้ว',
  },
  archive: {
    title: 'ยืนยันเก็บสินค้า',
    description: 'การเก็บถาวรจะซ่อนสินค้าไว้และกู้คืนไม่ได้ แต่ไม่ได้ลบสินค้าและรูปแบบออกจากระบบ',
    confirm: 'ยืนยันเก็บสินค้า',
    success: 'เก็บสินค้าแล้ว',
  },
}

const statusHelp: Record<ProductStatusValue, string> = {
  draft: 'ลูกค้ายังไม่เห็นสินค้านี้ แก้ไขข้อมูลได้อิสระ',
  published: 'ลูกค้าเห็นและสั่งซื้อสินค้านี้ได้ในหน้าร้าน',
  archived: 'ซ่อนสินค้าถาวรและกู้คืนไม่ได้ ข้อมูลและ SKU ยังอยู่ในประวัติ',
}

const statusBadge: Record<ProductStatusValue, 'success' | 'warning' | 'outline'> = {
  draft: 'warning',
  published: 'success',
  archived: 'outline',
}

function transitionFor(from: ProductStatusValue, to: ProductStatusValue): StatusTransition | null {
  if (from === to) return null
  if (to === 'archived') return 'archive'
  return to === 'published' ? 'publish' : 'unpublish'
}

type ProductFormLayout = {
  /** Extra sections rendered under the form in the main column (outside the form element). */
  main?: ReactNode
  /** Extra cards rendered under the status card in the sticky side column. */
  aside?: ReactNode
}

type ProductFormProps = ProductFormLayout & (
  | { mode: 'create'; onCreated: (productId: string) => void; onDirtyChange: (dirty: boolean) => void }
  | {
    mode: 'edit'
    product: ProductDetail
    readOnlyReason?: string
    canPublish: boolean
    canArchive: boolean
    onAddVariant?: () => void
    onArchived: () => void
    onDirtyChange: (dirty: boolean) => void
  }
)

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
    images: product.images.map(toMediaImageValue),
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
  const formId = useId()
  const vatTouched = useRef(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [createdProductId, setCreatedProductId] = useState<string | null>(null)
  const [createRecoveryStatus, setCreateRecoveryStatus] = useState<'idle' | 'checking' | 'ready' | 'failed'>('idle')
  const editProduct = props.mode === 'edit' ? props.product : null
  const savedStatus: ProductStatusValue = editProduct?.status ?? 'draft'
  const [status, setStatus] = useState<ProductStatusValue>(savedStatus)
  const [confirmingValues, setConfirmingValues] = useState<ProductEditValues | null>(null)
  const [saving, setSaving] = useState(false)
  const onCreated = props.mode === 'create' ? props.onCreated : null
  const onDirtyChange = props.onDirtyChange
  const readOnlyReason = props.mode === 'edit' ? props.readOnlyReason : undefined
  const canPublish = props.mode === 'edit' && props.canPublish
  const canArchive = props.mode === 'edit' && props.canArchive
  const watched = useWatch({ control: form.control }) as ProductCreateValues
  const transition = transitionFor(savedStatus, status)
  const fieldsDirty = form.formState.isDirty
  const dirty = fieldsDirty || transition !== null
  const checks = publicationChecks({
    slug: watched.slug ?? '',
    name: watched.name ?? '',
    category: watched.category,
    description: watched.description ?? '',
    images: watched.images ?? [],
    variants: editProduct?.variants ?? [],
  })
  const publishable = checks.every((check) => check.complete)
  const slugChanged = Boolean(editProduct && (watched.slug ?? '').trim() !== editProduct.slug)

  useEffect(() => {
    if (createdProductId) onCreated?.(createdProductId)
  }, [createdProductId, onCreated])

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  // Pick up server changes (another tab, a variant save) unless the staff member has unsaved edits.
  useEffect(() => {
    if (editProduct && !form.formState.isDirty) form.reset(fromProduct(editProduct))
  }, [editProduct, form])

  // A saved status change (or one made elsewhere) becomes the new baseline for the status picker.
  const [statusBaseline, setStatusBaseline] = useState(savedStatus)
  if (statusBaseline !== savedStatus) {
    setStatusBaseline(savedStatus)
    setStatus(savedStatus)
  }

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

  const saveEdits = async (values: ProductEditValues) => {
    if (!editProduct) return
    setServerError(null)
    setSaving(true)
    try {
      if (form.formState.isDirty) {
        await catalogApi.update(editProduct.id, toProductUpdateInput(values, editProduct.slug))
        form.reset(values)
      }
      if (transition === 'publish') await catalogApi.publish(editProduct.id)
      if (transition === 'unpublish') await catalogApi.unpublish(editProduct.id)
      if (transition === 'archive') await catalogApi.archive(editProduct.id)
      await invalidateCatalog(queryClient, editProduct.id)
      toast.add({ title: transition ? transitionCopy[transition].success : 'บันทึกข้อมูลสินค้าแล้ว', type: 'success' })
      if (transition === 'archive' && props.mode === 'edit') props.onArchived()
    } catch (error) {
      setServerError(apiErrorMessage(error))
      if (error instanceof ApiRequestError && error.code === 'PRODUCT_SLUG_CONFLICT') {
        form.setError('slug', { message: 'ชื่อ URL นี้ถูกใช้แล้ว หรือเคยเป็นลิงก์ของสินค้าอื่น' }, { shouldFocus: true })
      } else if (error instanceof ApiRequestError && error.status === 409) {
        await invalidateCatalog(queryClient, editProduct.id)
      }
    } finally {
      setSaving(false)
      setConfirmingValues(null)
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    if (props.mode === 'edit') {
      if (status === 'published' && !publishable) {
        setServerError('ข้อมูลยังไม่ครบเงื่อนไขการเผยแพร่ กรุณาเติมให้ครบก่อนบันทึก')
        return
      }
      if (transition) setConfirmingValues(values as ProductEditValues)
      else await saveEdits(values as ProductEditValues)
      return
    }
    try {
      const created = await catalogApi.create(toProductCreateInput(values as ProductCreateValues))
      await invalidateCatalog(queryClient, created.id)
      toast.add({ title: 'สร้างสินค้าแล้ว', type: 'success' })
      form.reset(emptyValues)
      onDirtyChange(false)
      setCreatedProductId(created.id)
    } catch (error) {
      setServerError(errorForCreate(error))
      if (isAmbiguousCreateFailure(error)) {
        setServerError(`${errorForCreate(error)} ระบบจะไม่ส่งคำขอสร้างซ้ำโดยอัตโนมัติ`)
        await refreshCatalogAfterUncertainCreate()
      }
    }
  })

  const errors = form.formState.errors
  const pending = form.formState.isSubmitting || saving
  const locked = pending || Boolean(readOnlyReason)
  const showActionBar = isCreate || dirty || pending || Boolean(serverError)
  const unsavedWarning = !isCreate && dirty
  const statusOptionDisabled = (value: ProductStatusValue) => {
    if (value === savedStatus) return false
    if (value === 'archived') return !canArchive
    if (value === 'published') return !canPublish || !publishable
    return !canPublish
  }
  const statusLocked = isCreate || locked || (!canPublish && !canArchive)
  const showChecklist = status !== 'archived' && !(savedStatus === 'published' && publishable)

  const statusCard = (
    <Card aria-labelledby="product-status-title" role="region">
      <CardHeader>
        <CardTitle><h2 id="product-status-title">สถานะ</h2></CardTitle>
        <CardDescription>{isCreate ? 'สินค้าใหม่จะเริ่มเป็นฉบับร่าง เพิ่มรูปแบบสินค้าหลังสร้างแล้วจึงเผยแพร่ได้' : 'การเปลี่ยนสถานะจะมีผลเมื่อกดบันทึกสินค้า'}</CardDescription>
        {!isCreate && <CardAction><Badge variant={statusBadge[savedStatus]}>ปัจจุบัน: {productStatusItems.find((item) => item.value === savedStatus)?.label}</Badge></CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="product-status">สถานะสินค้า</FieldLabel>
          <Select disabled={statusLocked} items={productStatusItems} onValueChange={(value) => value && setStatus(value as ProductStatusValue)} value={status}>
            <SelectTrigger aria-describedby="product-status-description" className="w-full" id="product-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent><SelectGroup>
              {productStatusItems.map((item) => <SelectItem disabled={statusOptionDisabled(item.value)} key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
          <FieldDescription className={cn(status === 'archived' && status !== savedStatus && 'text-destructive')} id="product-status-description">
            {statusHelp[status]}
            {!isCreate && !canPublish && !readOnlyReason && ' บัญชีนี้ไม่มีสิทธิ์เผยแพร่สินค้า'}
          </FieldDescription>
        </Field>
        {showChecklist && <PublicationChecklist canEdit={!locked} checks={checks} onAddVariant={props.mode === 'edit' && !locked ? props.onAddVariant : undefined} />}
      </CardContent>
    </Card>
  )

  const fields = (
    <form aria-label={isCreate ? 'ข้อมูลสินค้าใหม่' : 'ข้อมูลสินค้า'} className="flex flex-col gap-6" id={formId} noValidate onSubmit={onSubmit}>
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
              description={slugChanged
                ? `ลิงก์เดิม /products/${editProduct?.slug} จะพาลูกค้ามาที่ลิงก์ใหม่อัตโนมัติ`
                : 'ใช้ตัวอักษรภาษาอังกฤษตัวเล็ก ตัวเลข และขีดกลาง'}
              descriptionTone={slugChanged ? 'warning' : undefined}
              error={errors.slug?.message}
              disabled={locked}
              className="font-mono"
              {...form.register('slug')}
              required
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card aria-labelledby="product-image-title" role="region">
        <CardHeader>
          <CardTitle><h2 id="product-image-title">รูปภาพ</h2></CardTitle>
          <CardDescription>เลือกจากคลังภาพหรืออัปโหลดใหม่ รูปแรกใช้เป็นภาพปก เรียงลำดับได้สูงสุด 12 รูป</CardDescription>
        </CardHeader>
        <CardContent>
          <Controller
            control={form.control}
            name="images"
            render={({ field }) => <MediaGalleryField disabled={locked} id="product-images" onChange={field.onChange} value={field.value} />}
          />
          <FieldError id="product-images-error">{errors.images?.message}</FieldError>
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

      {transition && <ConfirmActionDialog
        open={Boolean(confirmingValues)}
        title={transitionCopy[transition].title}
        description={transitionCopy[transition].description}
        confirmLabel={transitionCopy[transition].confirm}
        confirmVariant={transition === 'archive' ? 'destructive' : 'default'}
        pending={saving}
        onOpenChange={(open) => !open && !saving && setConfirmingValues(null)}
        onConfirm={() => confirmingValues && void saveEdits(confirmingValues)}
      />}
    </form>
  )

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-6">
        {fields}
        {props.main}
        {showActionBar && !readOnlyReason && <div className={cn(
          'sticky bottom-4 z-10 flex flex-col gap-3 rounded-surface border px-4 py-3 shadow-lg',
          unsavedWarning
            ? 'border-warning/60 bg-[color-mix(in_oklch,var(--warning)_14%,var(--card))] dark:bg-[color-mix(in_oklch,var(--warning)_22%,var(--card))]'
            : 'bg-card',
        )}>
          {serverError && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{serverError}</p>}
          {createRecoveryStatus === 'checking' && <p className="text-sm text-muted-foreground" role="status">กำลังตรวจสอบรายการสินค้าล่าสุด...</p>}
          {createRecoveryStatus === 'failed' && <p className="text-sm text-destructive" role="alert">อัปเดตรายการสินค้าไม่สำเร็จ กรุณาตรวจสอบรายการก่อนสร้างสินค้าอีกครั้ง</p>}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className={cn('flex items-center gap-2 text-sm', unsavedWarning ? 'font-medium text-warning-foreground' : 'text-muted-foreground')} role="status">
              {unsavedWarning && <HugeiconsIcon aria-hidden="true" className="size-4 shrink-0" icon={Alert02Icon} strokeWidth={2} />}
              {isCreate ? 'สินค้าจะถูกสร้างเป็นฉบับร่าง แล้วเพิ่มรูปแบบสินค้าได้ในขั้นถัดไป' : pending ? 'กำลังบันทึก...' : transition && !fieldsDirty ? 'เปลี่ยนสถานะแล้ว ยังไม่ได้บันทึก' : 'มีการแก้ไขที่ยังไม่บันทึก'}
            </p>
            <div className="flex flex-wrap gap-2">
              {createRecoveryStatus === 'ready' && <Link className={buttonVariants({ variant: 'outline' })} to="/products">ตรวจสอบรายการสินค้า</Link>}
              {createRecoveryStatus === 'failed' && <Button disabled={pending} onClick={() => void refreshCatalogAfterUncertainCreate()} type="button" variant="outline">ลองโหลดรายการสินค้าอีกครั้ง</Button>}
              {editProduct && <Button disabled={pending} onClick={() => {
                form.reset(fromProduct(editProduct))
                setStatus(savedStatus)
                setServerError(null)
              }} type="button" variant="ghost">ทิ้งการแก้ไข</Button>}
              <Button disabled={pending || (isCreate && createRecoveryStatus !== 'idle')} form={formId} type="submit">{pending ? 'กำลังบันทึก...' : isCreate ? 'สร้างสินค้า' : 'บันทึกสินค้า'}</Button>
            </div>
          </div>
        </div>}
      </div>
      <aside aria-label="สถานะและข้อมูลสรุปสินค้า" className="flex flex-col gap-6 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
        {statusCard}
        {props.aside}
      </aside>
    </div>
  )
}

export function FormInput({ id, label, description, descriptionTone, error, ...props }: {
  id: string
  label: string
  description?: string
  descriptionTone?: 'warning'
  error?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input aria-describedby={[description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined} aria-invalid={Boolean(error)} id={id} {...props} />
      {description && <FieldDescription className={cn(descriptionTone === 'warning' && 'text-warning-foreground')} id={descriptionId}>{description}</FieldDescription>}
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
