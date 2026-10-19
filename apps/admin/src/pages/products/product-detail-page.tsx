import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { Add01Icon, Archive02Icon, ArrowDown01Icon, PencilEdit02Icon, WarehouseIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Badge } from '@workspace/ui/components/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@workspace/ui/components/breadcrumb'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { QueryState } from '@/components/query-state'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { catalogApi, type ProductDetail, type Variant, type VariantCreateInput, type VariantUpdateInput } from '@/lib/catalog/api'
import { formatMoney, formatTimestamp } from '@/lib/format'
import { isUuid } from '@/lib/ids'
import { hasPermission } from '@/lib/permissions'
import { catalogKeys, invalidateCatalog, productQuery } from '@/lib/catalog/queries'
import { toast } from '@workspace/ui/components/toast'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'
import { ProductForm } from './_components/product-form'
import { ProductHeaderActions, PublicationChecklist, ConfirmActionDialog } from './_components/product-actions'
import { VariantDialog } from './_components/variant-dialog'
import { ProductFarms } from './_components/product-farms'
import { IconTooltip } from './_components/icon-tooltip'
import { cn } from '@workspace/ui/lib/utils'

function statusLabel(status: ProductDetail['status']) {
  return status === 'published' ? 'เผยแพร่แล้ว' : status === 'draft' ? 'ร่าง' : 'เก็บถาวร'
}

function detailState(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 404) return { kind: 'not-found' as const, message: 'ไม่พบสินค้า' }
  if (error instanceof ApiRequestError && error.status === 403) return { kind: 'forbidden' as const, message: 'ไม่มีสิทธิ์เข้าถึงสินค้านี้' }
  return { kind: 'error' as const, message: apiErrorMessage(error) }
}

function ProductDetail({ product }: { product: ProductDetail }) {
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canUpdate = hasPermission(session, 'catalog:update')
  const canCreate = hasPermission(session, 'catalog:create')
  const canDelete = hasPermission(session, 'catalog:delete')
  const canReadInventory = hasPermission(session, 'inventory:read')
  const productArchived = product.status === 'archived'
  const canEditProduct = canUpdate && !productArchived
  const canAddVariant = canCreate && !productArchived
  const [productDirty, setProductDirty] = useState(false)
  const [variantDialogOpen, setVariantDialogOpen] = useState(false)
  const [variantDirty, setVariantDirty] = useState(false)
  const [variantBeingEdited, setVariantBeingEdited] = useState<Variant | null>(null)
  const [variantConflictRefreshFailed, setVariantConflictRefreshFailed] = useState(false)
  const [variantBeingArchived, setVariantBeingArchived] = useState<Variant | null>(null)
  const [variantError, setVariantError] = useState<string | null>(null)
  const [showArchivedVariants, setShowArchivedVariants] = useState(false)
  const unsavedConfirmation = useUnsavedChanges(productDirty || variantDirty)
  const orderedVariants = [...product.variants].sort((left, right) => left.displayOrder - right.displayOrder)
  const activeVariants = orderedVariants.filter((variant) => !variant.archivedAt)
  const archivedVariants = orderedVariants.filter((variant) => variant.archivedAt)
  const archivedVisible = showArchivedVariants || activeVariants.length === 0
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

  const openVariantDialog = (variant: Variant | null) => {
    setVariantBeingEdited(variant)
    setVariantConflictRefreshFailed(false)
    setVariantDialogOpen(true)
  }

  const refreshVariantConflict = async (variantId?: string) => {
    let refreshFailed = false
    try {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all, refetchType: 'all' }, { throwOnError: true })
    } catch {
      refreshFailed = true
    }
    const detailQueryKey = productQuery(product.id).queryKey
    const refreshedProduct = queryClient.getQueryData<ProductDetail>(detailQueryKey)
    const latestVariant = variantId ? refreshedProduct?.variants.find((candidate) => candidate.id === variantId) : undefined
    refreshFailed = refreshFailed || !refreshedProduct || Boolean(queryClient.getQueryState(detailQueryKey)?.error) || Boolean(variantId && !latestVariant)
    setVariantConflictRefreshFailed(refreshFailed)
    if (latestVariant) setVariantBeingEdited(latestVariant)
  }

  const saveVariant = async (input: VariantCreateInput | VariantUpdateInput, variantId?: string) => {
    try {
      if (variantId) await catalogApi.updateVariant(product.id, variantId, input as VariantUpdateInput)
      else await catalogApi.createVariant(product.id, input as VariantCreateInput)
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) await refreshVariantConflict(variantId)
      throw error
    }
    await invalidateCatalog(queryClient, product.id)
    toast.add({ title: variantId ? 'บันทึกรูปแบบสินค้าแล้ว' : 'เพิ่มรูปแบบสินค้าแล้ว', type: 'success' })
    setVariantBeingEdited(null)
    setVariantError(null)
  }

  const variantRow = (variant: Variant) => {
    const archived = Boolean(variant.archivedAt)
    const lastActiveVariant = product.status === 'published' && !archived && activeVariants.length === 1
    const canArchive = canDelete && !archived && !productArchived && !lastActiveVariant
    const archiveReasonId = `variant-${variant.id}-archive-reason`
    return <TableRow className={cn(archived && 'text-muted-foreground')} key={variant.id}>
      <TableCell className={cn('font-medium', !archived && 'text-foreground')}>{variant.sku}</TableCell>
      <TableCell>{variant.name}</TableCell>
      <TableCell>
        <span>{variant.unit}</span>
        <span className="text-muted-foreground"> · ≥{variant.minRemainingShelfLifeDays} วัน</span>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatMoney(variant.priceSatang)}</TableCell>
      <TableCell><Badge variant={archived ? 'outline' : variant.salesEnabled ? 'success' : 'secondary'}>
        {archived ? 'เก็บถาวร' : variant.salesEnabled ? 'เปิดขาย' : 'ปิดขาย'}
      </Badge></TableCell>
      <TableCell>
        <div className="flex justify-end gap-0.5">
          {canReadInventory && <IconTooltip label="ดูสต็อก">
            <Link aria-label={`ดูสต็อก ${variant.sku}`} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })} to={`/inventory/variants/${variant.id}?productId=${product.id}`}>
              <HugeiconsIcon icon={WarehouseIcon} strokeWidth={2} />
            </Link>
          </IconTooltip>}
          {!archived && canUpdate && !productArchived && <IconTooltip label="แก้ไขรูปแบบ">
            <Button aria-label={`แก้ไขรูปแบบ ${variant.sku}`} onClick={() => openVariantDialog(variant)} size="icon-sm" variant="ghost">
              <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
            </Button>
          </IconTooltip>}
          {!archived && canDelete && !productArchived && (lastActiveVariant
            ? <IconTooltip label="สินค้าที่เผยแพร่แล้วต้องมีรูปแบบที่ใช้งานได้อย่างน้อยหนึ่งรายการ">
              <span className="inline-flex rounded-control outline-none focus-visible:ring-3 focus-visible:ring-ring/50" tabIndex={0}>
                <Button aria-describedby={archiveReasonId} aria-label={`เก็บรูปแบบสินค้า ${variant.sku}`} disabled size="icon-sm" variant="ghost">
                  <HugeiconsIcon icon={Archive02Icon} strokeWidth={2} />
                </Button>
                <span className="sr-only" id={archiveReasonId}>สินค้าที่เผยแพร่แล้วต้องมีรูปแบบที่ใช้งานได้อย่างน้อยหนึ่งรายการ</span>
              </span>
            </IconTooltip>
            : <IconTooltip label="เก็บรูปแบบสินค้า">
              <Button aria-label={`เก็บรูปแบบสินค้า ${variant.sku}`} disabled={!canArchive || archiveVariantMutation.isPending} onClick={() => setVariantBeingArchived(variant)} size="icon-sm" variant="ghost">
                <HugeiconsIcon icon={Archive02Icon} strokeWidth={2} />
              </Button>
            </IconTooltip>)}
        </div>
      </TableCell>
    </TableRow>
  }

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 lg:px-6">
      <header className="flex flex-col gap-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink render={<Link to="/products" />}>สินค้า</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage className="max-w-64 truncate">{product.name}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-headline font-semibold tracking-tight text-balance">{product.name}</h1>
              <Badge variant={product.status === 'published' ? 'success' : product.status === 'draft' ? 'warning' : 'outline'}>{statusLabel(product.status)}</Badge>
            </div>
            {product.englishName && <p className="text-muted-foreground">{product.englishName}</p>}
          </div>
          <ProductHeaderActions formDirty={productDirty} product={product} />
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <ProductForm
              mode="edit"
              onDirtyChange={setProductDirty}
              product={product}
              readOnlyReason={productArchived ? 'สินค้านี้ถูกเก็บถาวรแล้ว จึงแก้ไขข้อมูลไม่ได้' : !canUpdate ? 'บัญชีนี้ดูข้อมูลสินค้าได้อย่างเดียว' : undefined}
            />

            <Card aria-labelledby="product-variants-title" role="region">
              <CardHeader>
                <CardTitle><h2 id="product-variants-title">รูปแบบสินค้า</h2></CardTitle>
                <CardDescription>SKU เปลี่ยนไม่ได้หลังสร้าง และรูปแบบที่เก็บถาวรยังคงแสดงในประวัติสินค้า</CardDescription>
                {canAddVariant && <CardAction>
                  <Button onClick={() => openVariantDialog(null)} size="sm">
                    <HugeiconsIcon data-icon="inline-start" icon={Add01Icon} strokeWidth={2} />
                    เพิ่มรูปแบบสินค้า
                  </Button>
                </CardAction>}
              </CardHeader>
              <CardContent className="flex flex-col gap-3 px-0">
                {variantError && <p aria-live="assertive" className="px-(--card-spacing) text-sm text-destructive" role="alert">{variantError}</p>}
                <div className="overflow-x-auto border-y">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-(--card-spacing)">SKU</TableHead>
                        <TableHead>ชื่อรูปแบบ</TableHead>
                        <TableHead>หน่วย · อายุขั้นต่ำ</TableHead>
                        <TableHead className="text-right">ราคา</TableHead>
                        <TableHead>การขาย</TableHead>
                        <TableHead className="pr-(--card-spacing)"><span className="sr-only">การดำเนินการ</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="[&_td:first-child]:pl-(--card-spacing) [&_td:last-child]:pr-(--card-spacing)">
                      {orderedVariants.length > 0
                        ? <>
                          {activeVariants.map(variantRow)}
                          {archivedVariants.length > 0 && activeVariants.length > 0 && <TableRow className="hover:bg-transparent">
                            <TableCell className="py-1" colSpan={6}>
                              <Button aria-controls="archived-variant-rows" aria-expanded={archivedVisible} className="-ml-2 text-muted-foreground" onClick={() => setShowArchivedVariants((value) => !value)} size="sm" variant="ghost">
                                <HugeiconsIcon className={cn('transition-transform', !archivedVisible && '-rotate-90')} data-icon="inline-start" icon={ArrowDown01Icon} strokeWidth={2} />
                                เก็บถาวรแล้ว ({archivedVariants.length})
                              </Button>
                            </TableCell>
                          </TableRow>}
                          {archivedVisible && archivedVariants.map(variantRow)}
                        </>
                        : <TableRow><TableCell className="p-0" colSpan={6}><Empty className="min-h-32 border-0"><EmptyHeader><EmptyTitle>ยังไม่มีรูปแบบสินค้า</EmptyTitle><EmptyDescription>เพิ่มรูปแบบสินค้าเพื่อกำหนด SKU หน่วย และราคา</EmptyDescription></EmptyHeader></Empty></TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <ProductFarms product={product} />
          </div>

          <aside aria-label="ข้อมูลสรุปสินค้า" className="flex flex-col gap-6">
            <PublicationChecklist
              onAddVariant={canAddVariant ? () => openVariantDialog(null) : undefined}
              canEdit={canEditProduct}
              product={product}
            />
            <Card aria-labelledby="product-meta-title" role="region" size="sm">
              <CardHeader>
                <CardTitle><h2 id="product-meta-title">ประวัติ</h2></CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                  <MetaField label="สร้างเมื่อ" value={formatTimestamp(product.createdAt)} />
                  {product.publishedAt && <MetaField label="เผยแพร่เมื่อ" value={formatTimestamp(product.publishedAt)} />}
                  <MetaField label="แก้ไขล่าสุด" value={formatTimestamp(product.updatedAt)} />
                </dl>
              </CardContent>
            </Card>
          </aside>
        </div>

      {variantDialogOpen && <VariantDialog
        latestProductStatus={product.status}
        latestVariants={product.variants}
        latestVariant={variantBeingEdited ? product.variants.find((candidate) => candidate.id === variantBeingEdited.id) ?? null : null}
        onRefreshLatest={() => refreshVariantConflict(variantBeingEdited?.id)}
        onDirtyChange={setVariantDirty}
        onOpenChange={(open) => {
          setVariantDialogOpen(open)
          if (!open) {
            setVariantDirty(false)
            setVariantBeingEdited(null)
          }
        }}
        onSave={saveVariant}
        open={variantDialogOpen}
        refreshFailed={variantConflictRefreshFailed}
        variant={variantBeingEdited}
      />}
      {variantBeingArchived && <ConfirmActionDialog
        open={Boolean(variantBeingArchived)}
        title="ยืนยันเก็บรูปแบบสินค้า"
        description={`เก็บ ${variantBeingArchived.sku} ไว้ในประวัติสินค้า รูปแบบและ SKU จะไม่ถูกลบ`}
        confirmLabel="เก็บรูปแบบสินค้า"
        confirmVariant="destructive"
        pending={archiveVariantMutation.isPending}
        onOpenChange={(open) => !open && setVariantBeingArchived(null)}
        onConfirm={() => archiveVariantMutation.mutate(variantBeingArchived)}
      />}
      {unsavedConfirmation}
    </section>
  )
}

function MetaField({ label, value }: { label: string; value: ReactNode }) {
  return <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-right">{value}</dd>
  </>
}

function ProductDetailSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite" className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 lg:px-6" role="status">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <Skeleton className="h-9 w-64" />
          <div className="flex gap-2"><Skeleton className="h-9 w-24" /><Skeleton className="h-9 w-28" /></div>
        </div>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-64 w-full rounded-surface" />
          <Skeleton className="h-40 w-full rounded-surface" />
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="aspect-square w-full rounded-surface" />
          <Skeleton className="h-48 w-full rounded-surface" />
        </div>
      </div>
      <span className="sr-only">กำลังโหลดข้อมูล...</span>
    </section>
  )
}

export function Component() {
  const { productId } = useParams()
  const validProductId = isUuid(productId)
  const product = useQuery({ ...productQuery(productId ?? ''), enabled: validProductId })

  if (!productId) return <QueryState kind="not-found" message="ไม่พบสินค้า" />
  if (!validProductId) return <section className="flex flex-col gap-4 px-4 lg:px-6">
    <QueryState kind="not-found" message="รหัสสินค้าไม่ถูกต้อง" />
    <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/products">กลับไปหน้าสินค้า</Link>
  </section>
  if (product.isPending) return <ProductDetailSkeleton />
  if (product.error && !product.data) {
    const state = detailState(product.error)
    return <section className="flex flex-col gap-4 px-4 lg:px-6">
      <QueryState kind={state.kind} message={state.message} onRetry={state.kind === 'error' ? () => void product.refetch() : undefined} />
      {state.kind === 'not-found' && <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/products">กลับไปหน้าสินค้า</Link>}
    </section>
  }

  return <ProductDetail product={product.data} />
}
