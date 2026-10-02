import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { QueryState } from '@/components/query-state'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { catalogApi, type ProductDetail, type Variant, type VariantCreateInput, type VariantUpdateInput } from '@/lib/catalog/api'
import { formatMoney, formatTimestamp } from '@/lib/format'
import { hasPermission } from '@/lib/permissions'
import { invalidateCatalog, productQuery } from '@/lib/catalog/queries'
import { toast } from '@workspace/ui/components/toast'
import { ProductForm } from './_components/product-form'
import { ProductActions, ConfirmActionDialog } from './_components/product-actions'
import { VariantDialog } from './_components/variant-dialog'
import { cn } from '@workspace/ui/lib/utils'

function categoryLabel(category: ProductDetail['category']) {
  return category === 'fresh' ? 'สินค้าสด' : 'สินค้าแปรรูป'
}

function statusLabel(status: ProductDetail['status']) {
  return status === 'published' ? 'เผยแพร่แล้ว' : status === 'draft' ? 'ร่าง' : 'เก็บถาวร'
}

function detailState(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 404) return { kind: 'not-found' as const, message: 'ไม่พบสินค้า' }
  if (error instanceof ApiRequestError && error.status === 403) return { kind: 'forbidden' as const, message: 'ไม่มีสิทธิ์เข้าถึงสินค้านี้' }
  return { kind: 'error' as const, message: apiErrorMessage(error) }
}

function ProductImage({ product }: { product: ProductDetail }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (!product.imageUrl || failedUrl === product.imageUrl) {
    return <div aria-label={failedUrl ? 'โหลดรูปภาพไม่ได้' : 'ไม่มีรูปภาพ'} className="grid min-h-48 place-items-center rounded-md bg-muted text-sm text-muted-foreground" role="img">{failedUrl ? 'โหลดรูปภาพไม่ได้' : 'ไม่มีรูปภาพสินค้า'}</div>
  }

  return <img alt={product.imageAlt || product.name} className="max-h-72 w-full rounded-md border object-contain" onError={() => setFailedUrl(product.imageUrl)} src={product.imageUrl} />
}

function ProductDetail({ product }: { product: ProductDetail }) {
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canUpdate = hasPermission(session, 'catalog:update')
  const canCreate = hasPermission(session, 'catalog:create')
  const canDelete = hasPermission(session, 'catalog:delete')
  const [editing, setEditing] = useState(false)
  const [variantDialogOpen, setVariantDialogOpen] = useState(false)
  const [variantBeingEdited, setVariantBeingEdited] = useState<Variant | null>(null)
  const [variantBeingArchived, setVariantBeingArchived] = useState<Variant | null>(null)
  const [variantError, setVariantError] = useState<string | null>(null)
  const activeVariants = product.variants.filter((variant) => !variant.archivedAt)
  const archiveVariantMutation = useMutation({
    mutationFn: (variant: Variant) => catalogApi.archiveVariant(product.id, variant.id),
    retry: false,
    onSuccess: async () => {
      await invalidateCatalog(queryClient, product.id)
      toast.add({ title: 'เก็บรูปแบบสินค้าแล้ว', type: 'success' })
      setVariantBeingArchived(null)
      setVariantError(null)
    },
    onError: async (error) => {
      setVariantError(apiErrorMessage(error))
      await invalidateCatalog(queryClient, product.id)
    },
  })

  const saveVariant = async (input: VariantCreateInput | VariantUpdateInput, variantId?: string) => {
    if (variantId) await catalogApi.updateVariant(product.id, variantId, input as VariantUpdateInput)
    else await catalogApi.createVariant(product.id, input as VariantCreateInput)
    await invalidateCatalog(queryClient, product.id)
    toast.add({ title: variantId ? 'บันทึกรูปแบบสินค้าแล้ว' : 'เพิ่มรูปแบบสินค้าแล้ว', type: 'success' })
    setVariantBeingEdited(null)
    setVariantError(null)
  }

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-4">
        <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/products">กลับไปหน้าสินค้า</Link>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{product.name}</h1>
            <Badge variant={product.status === 'published' ? 'default' : product.status === 'draft' ? 'secondary' : 'outline'}>{statusLabel(product.status)}</Badge>
          </div>
          {product.englishName && <p className="text-muted-foreground">{product.englishName}</p>}
          <p className="text-sm text-muted-foreground">{categoryLabel(product.category)} · {product.slug}</p>
        </div>
        {!editing && canUpdate && product.status !== 'archived' && <Button className="w-fit" onClick={() => setEditing(true)} variant="outline">แก้ไขสินค้า</Button>}
      </div>

      {editing
        ? <ProductForm mode="edit" onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} product={product} />
        : <div className="grid gap-6 lg:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="text-lg font-semibold">รายละเอียด</h2>
            <dl className="grid gap-4 text-sm">
              <DetailField label="คำอธิบาย" value={product.description} />
              <DetailField label="เรื่องราวจากสวน" value={product.originStory} />
              <DetailField label="วิธีเก็บรักษา" value={product.storageInstructions} />
              <DetailField label="แก้ไขล่าสุด" value={formatTimestamp(product.updatedAt)} />
            </dl>
          </section>
          <section className="flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="text-lg font-semibold">รูปสินค้า</h2>
            <ProductImage product={product} />
          </section>
        </div>}

      {!editing && <ProductActions product={product} />}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">รูปแบบสินค้า</h2>
            <p className="text-sm text-muted-foreground">SKU เปลี่ยนไม่ได้หลังสร้าง และรูปแบบที่เก็บถาวรยังคงแสดงในประวัติสินค้า</p>
          </div>
          {canCreate && product.status !== 'archived' && <Button onClick={() => {
            setVariantBeingEdited(null)
            setVariantDialogOpen(true)
          }}>เพิ่มรูปแบบสินค้า</Button>}
        </div>
        {variantError && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{variantError}</p>}
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>ชื่อรูปแบบ</TableHead>
                <TableHead>หน่วย</TableHead>
                <TableHead className="text-right">ราคา</TableHead>
                <TableHead>การขาย</TableHead>
                <TableHead>ลำดับ</TableHead>
                <TableHead>อายุคงเหลือขั้นต่ำ</TableHead>
                <TableHead><span className="sr-only">การดำเนินการ</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.variants.length > 0
                ? product.variants.map((variant) => {
                  const lastActiveVariant = product.status === 'published' && !variant.archivedAt && activeVariants.length === 1
                  const canArchive = canDelete && !variant.archivedAt && product.status !== 'archived' && !lastActiveVariant
                  return <TableRow key={variant.id}>
                    <TableCell className="font-medium">{variant.sku}</TableCell>
                    <TableCell>{variant.name}</TableCell>
                    <TableCell>{variant.unit}</TableCell>
                    <TableCell className="text-right">{formatMoney(variant.priceSatang)}</TableCell>
                    <TableCell><Badge variant={variant.archivedAt ? 'outline' : variant.salesEnabled ? 'default' : 'secondary'}>
                      {variant.archivedAt ? 'เก็บถาวร' : variant.salesEnabled ? 'เปิดขาย' : 'ปิดขาย'}
                    </Badge></TableCell>
                    <TableCell>{variant.displayOrder}</TableCell>
                    <TableCell>{variant.minRemainingShelfLifeDays} วัน</TableCell>
                    <TableCell>
                      {!variant.archivedAt && <div className="flex flex-wrap gap-2">
                        {canUpdate && product.status !== 'archived' && <Button onClick={() => {
                          setVariantBeingEdited(variant)
                          setVariantDialogOpen(true)
                        }} size="sm" variant="outline">แก้ไขรูปแบบ {variant.sku}</Button>}
                        {canDelete && product.status !== 'archived' && <Button disabled={!canArchive || archiveVariantMutation.isPending} onClick={() => setVariantBeingArchived(variant)} size="sm" variant="outline" aria-describedby={lastActiveVariant ? `variant-${variant.id}-archive-reason` : undefined}>
                          เก็บรูปแบบสินค้า {variant.sku}
                        </Button>}
                      </div>}
                      {lastActiveVariant && <p className="max-w-64 text-xs text-muted-foreground" id={`variant-${variant.id}-archive-reason`}>สินค้าที่เผยแพร่แล้วต้องมีรูปแบบที่ใช้งานได้อย่างน้อยหนึ่งรายการ</p>}
                    </TableCell>
                  </TableRow>
                })
                : <TableRow><TableCell className="p-0" colSpan={8}><Empty className="min-h-32 border-0"><EmptyHeader><EmptyTitle>ยังไม่มีรูปแบบสินค้า</EmptyTitle><EmptyDescription>เพิ่มรูปแบบสินค้าเพื่อกำหนด SKU หน่วย และราคา</EmptyDescription></EmptyHeader></Empty></TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </section>
      {variantDialogOpen && <VariantDialog
        onOpenChange={(open) => {
          setVariantDialogOpen(open)
          if (!open) setVariantBeingEdited(null)
        }}
        onSave={saveVariant}
        open={variantDialogOpen}
        variant={variantBeingEdited}
      />}
      {variantBeingArchived && <ConfirmActionDialog
        open={Boolean(variantBeingArchived)}
        title="ยืนยันเก็บรูปแบบสินค้า"
        description={`เก็บ ${variantBeingArchived.sku} ไว้ในประวัติสินค้า รูปแบบและ SKU จะไม่ถูกลบ`}
        confirmLabel="เก็บรูปแบบสินค้า"
        pending={archiveVariantMutation.isPending}
        onOpenChange={(open) => !open && setVariantBeingArchived(null)}
        onConfirm={() => archiveVariantMutation.mutate(variantBeingArchived)}
      />}
    </section>
  )
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-medium">{label}</dt>
      <dd className="whitespace-pre-wrap text-muted-foreground">{value || 'ยังไม่มีข้อมูล'}</dd>
    </div>
  )
}

export function Component() {
  const { productId } = useParams()
  const product = useQuery({ ...productQuery(productId ?? ''), enabled: Boolean(productId) })

  if (!productId) return <QueryState kind="not-found" message="ไม่พบสินค้า" />
  if (product.isPending) return <QueryState kind="loading" />
  if (product.error) {
    const state = detailState(product.error)
    return <section className="flex flex-col gap-4 px-4 lg:px-6">
      <QueryState kind={state.kind} message={state.message} onRetry={state.kind === 'error' ? () => void product.refetch() : undefined} />
      {state.kind === 'not-found' && <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/products">กลับไปหน้าสินค้า</Link>}
    </section>
  }

  return <ProductDetail product={product.data} />
}
