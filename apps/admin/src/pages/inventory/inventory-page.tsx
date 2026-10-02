import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { ProductVariantPicker, type VariantSelection } from '@/components/product-variant-picker'
import { buttonVariants } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { QueryState } from '@/components/query-state'
import { useCursorPagination } from '@/hooks/use-cursor-pagination'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { productQuery } from '@/lib/catalog/queries'
import { lotsQuery, stockSummaryQuery, warehouseQuery } from '@/lib/inventory/queries'
import { hasPermission } from '@/lib/permissions'
import { authSessionQuery } from '@/lib/auth-session'
import { LotTable } from './_components/lot-table'
import { InventoryNavigation } from './_components/inventory-navigation'
import { StockSummary } from './_components/stock-summary'
import { variantLabel } from './_components/variant-metadata'

function requestState(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 403) return { kind: 'forbidden' as const, message: 'ไม่มีสิทธิ์เข้าถึงสต็อก' }
  if (error instanceof ApiRequestError && error.status === 404) return { kind: 'not-found' as const, message: 'ไม่พบคลังสินค้าหลัก' }
  return { kind: 'error' as const, message: apiErrorMessage(error) }
}

export function Component() {
  const location = useLocation()
  const queryClient = useQueryClient()
  const { cursor, limit, canPrevious, next, previous, first, setLimit, setFilters } = useCursorPagination(['variantId', 'productId'])
  const params = new URLSearchParams(location.search)
  const variantId = params.get('variantId') || undefined
  const productId = params.get('productId') || undefined
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canReadCatalog = hasPermission(session, 'catalog:read')
  const canAdjustInventory = hasPermission(session, 'inventory:adjust')
  const product = useQuery({ ...productQuery(productId ?? ''), enabled: Boolean(productId && canReadCatalog) })
  const selectedVariant = product.data?.variants.find((candidate) => candidate.id === variantId)
  const selection: VariantSelection | null = selectedVariant && product.data
    ? { productId: product.data.id, productName: product.data.name, variant: selectedVariant }
    : null
  const warehouse = useQuery(warehouseQuery())
  const query = { warehouseId: warehouse.data?.id, variantId, limit, cursor }
  const lots = useQuery({ ...lotsQuery(query), enabled: Boolean(warehouse.data) })
  const summary = useQuery({ ...stockSummaryQuery(variantId ?? ''), enabled: Boolean(variantId) })
  useEffect(() => {
    if (!variantId || !productId || product.isPending || !product.data || selectedVariant) return
    setFilters({ variantId, productId: undefined })
  }, [product.data, product.isPending, productId, selectedVariant, setFilters, variantId])

  function selectVariant(value: VariantSelection | null) {
    setFilters({ variantId: value?.variant.id, productId: value?.productId })
  }

  if (warehouse.isPending) return <section className="px-4 lg:px-6"><QueryState kind="loading" /></section>
  if (warehouse.error) {
    const state = requestState(warehouse.error)
    return <section className="px-4 lg:px-6"><QueryState kind={state.kind} message={state.message} onRetry={state.kind === 'error' ? () => void warehouse.refetch() : undefined} /></section>
  }

  const metadata = selection ? { product: product.data!, variant: selectedVariant! } : undefined
  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">สต็อกสินค้า</h1>
          <p className="text-sm text-muted-foreground">คลังหลัก · {warehouse.data.name} ({warehouse.data.code})</p>
        </div>
        {canAdjustInventory && <Link className={cn(buttonVariants(), 'w-fit')} to="/inventory/lots/new">รับสินค้าเข้าคลัง</Link>}
      </div>
      <InventoryNavigation variantId={variantId} productId={productId} />
      {canReadCatalog && <ProductVariantPicker onChange={selectVariant} value={selection} />}
      {variantId && productId && !canReadCatalog && <p className="text-sm text-muted-foreground" role="status">ไม่มีสิทธิ์อ่านข้อมูลสินค้า จะแสดงรหัสรูปแบบสินค้าแทนชื่อ</p>}
      {variantId && productId && product.data && !selectedVariant && <p className="text-sm text-muted-foreground" role="status">ไม่พบรูปแบบสินค้านี้ในสินค้าที่เลือก จะแสดงผลตามรหัสรูปแบบสินค้า</p>}
      {variantId && summary.data && <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">สรุปสต็อก{variantLabel(metadata) ? ` · ${variantLabel(metadata)}` : ` · ${variantId}`}</h2>
        <StockSummary summary={summary.data} />
      </section>}
      {variantId && summary.isPending && <QueryState kind="loading" />}
      {variantId && summary.error && <QueryState kind="error" message={apiErrorMessage(summary.error)} onRetry={() => void summary.refetch()} />}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">ล็อตสินค้า{selection ? ` · ${selection.variant.sku}` : ''}</h2>
          <p className="text-sm text-muted-foreground">แสดงล็อตที่หมดอายุ กักกัน หรือไม่มีของคงเหลือ เพื่อให้ตรวจสอบประวัติได้</p>
        </div>
        <LotTable
          canPrevious={canPrevious}
          error={lots.error}
          hasCursor={Boolean(cursor)}
          isPending={lots.isPending}
          isRefreshing={lots.isFetching && !lots.isPending}
          limit={limit}
          lots={lots.data?.items ?? []}
          nextCursor={lots.data?.nextCursor ?? null}
          onFirst={first}
          onLimitChange={setLimit}
          onNext={next}
          onPrevious={previous}
          onRetry={() => void lots.refetch()}
          showProductMetadata={canReadCatalog}
        />
      </section>
    </section>
  )
}
