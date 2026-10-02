import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router'
import { buttonVariants } from '@workspace/ui/components/button'
import { QueryState } from '@/components/query-state'
import { useCursorPagination } from '@/hooks/use-cursor-pagination'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { productQuery } from '@/lib/catalog/queries'
import { lotsQuery, stockSummaryQuery, warehouseQuery } from '@/lib/inventory/queries'
import { hasPermission } from '@/lib/permissions'
import { cn } from '@workspace/ui/lib/utils'
import { CopyableId } from './_components/copyable-id'
import { InventoryNavigation } from './_components/inventory-navigation'
import { LotTable } from './_components/lot-table'
import { StockSummary } from './_components/stock-summary'
import { cachedVariantMetadata, variantLabel } from './_components/variant-metadata'

function notFound(error: unknown) {
  return error instanceof ApiRequestError && error.status === 404
}

export function Component() {
  const { variantId } = useParams()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { cursor, limit, canPrevious, next, previous, first, setLimit } = useCursorPagination([])
  const params = new URLSearchParams(location.search)
  const productId = params.get('productId') || undefined
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canReadCatalog = hasPermission(session, 'catalog:read')
  const warehouse = useQuery(warehouseQuery())
  const summary = useQuery({ ...stockSummaryQuery(variantId ?? ''), enabled: Boolean(variantId) })
  const product = useQuery({ ...productQuery(productId ?? ''), enabled: Boolean(productId && canReadCatalog) })
  const matchingVariant = productId && product.data?.id === productId
    ? product.data.variants.find((candidate) => candidate.id === variantId)
    : undefined
  const relatedMetadata = productId
    ? matchingVariant && product.data ? { product: product.data, variant: matchingVariant } : undefined
    : canReadCatalog && variantId ? cachedVariantMetadata(queryClient, variantId) : undefined
  const query = { warehouseId: warehouse.data?.id, variantId, limit, cursor }
  const lots = useQuery({ ...lotsQuery(query), enabled: Boolean(warehouse.data && variantId) })

  if (!variantId) return <section className="px-4 lg:px-6"><QueryState kind="not-found" message="ไม่พบรหัสรูปแบบสินค้า" /></section>
  if (warehouse.isPending || summary.isPending) return <section className="px-4 lg:px-6"><QueryState kind="loading" /></section>
  if (notFound(summary.error)) return <section className="flex flex-col gap-4 px-4 lg:px-6"><QueryState kind="not-found" message="ไม่พบสต็อกของรูปแบบสินค้านี้" /><Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/inventory">กลับไปหน้าสต็อก</Link></section>
  if (warehouse.error || summary.error) {
    const error = warehouse.error ?? summary.error
    return <section className="px-4 lg:px-6"><QueryState kind="error" message={apiErrorMessage(error)} onRetry={() => void (warehouse.error ? warehouse.refetch() : summary.refetch())} /></section>
  }

  const title = variantLabel(relatedMetadata) ?? variantId
  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-3">
        <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/inventory">กลับไปหน้าสต็อก</Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">สต็อกรูปแบบสินค้า</h1>
          <p className="text-muted-foreground">{title}</p>
          {!relatedMetadata && <CopyableId label="รหัสรูปแบบสินค้า" value={variantId} />}
        </div>
      <InventoryNavigation variantId={variantId} productId={productId} />
      {productId && !canReadCatalog && <p className="text-sm text-muted-foreground" role="status">ไม่มีสิทธิ์อ่านข้อมูลสินค้า จะแสดงรหัสรูปแบบสินค้าแทนชื่อ</p>}
      </div>
      {productId && product.data && !matchingVariant && <p className="text-sm text-muted-foreground" role="status">รูปแบบสินค้านี้ไม่ได้อยู่ในสินค้าที่ระบุ จึงแสดงรหัสรูปแบบสินค้าโดยไม่ใช้ชื่อสินค้า</p>}
      {productId && product.error && <p className="text-sm text-muted-foreground" role="status">โหลดข้อมูลสินค้าเพื่อแสดงชื่อไม่สำเร็จ แสดงรหัสรูปแบบสินค้าแทน</p>}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-xl font-semibold">คลังหลัก · {warehouse.data.name}</h2>
          <p className="text-sm text-muted-foreground">สต็อกในคลังหลัก · {warehouse.data.code}</p>
        </div>
        <StockSummary summary={summary.data} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">ล็อตของรูปแบบสินค้านี้</h2>
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
