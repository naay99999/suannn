import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { useDebouncedValue } from '@workspace/ui/hooks/use-debounced-value'
import { cn } from '@workspace/ui/lib/utils'
import { ButtonSpinner } from '@/components/loading/button-spinner'
import { ProductGridSkeleton } from '@/components/loading/product-grid-skeleton'
import { ProductCard } from '@/components/product-card'
import { getStoreProducts, readCatalogFilters, storeProductCatalogQueryKey, type StoreProductQuery } from '@/lib/store-products'
import { CatalogFilters, CatalogToolbar } from './_components/catalog-filters'
import { useProductMotion } from './_components/use-product-motion'

const pageSize = 24
const searchDebounceMs = 300
const gridClassName = 'grid grid-flow-dense grid-cols-1 gap-x-3 gap-y-7 @min-[320px]/catalog:grid-cols-2 @min-[640px]/catalog:grid-cols-3 @min-[640px]/catalog:gap-x-5 @min-[950px]/catalog:grid-cols-4'

export function ProductCatalog({ fixedCategory, title = 'สินค้าจากสวน' }: { fixedCategory?: StoreProductQuery['category']; title?: string }) {
  const [params, setParams] = useSearchParams()
  const filters = readCatalogFilters(params)
  const q = useDebouncedValue(filters.q, searchDebounceMs)
  const query = {
    ...(q ? { q } : {}),
    category: fixedCategory ?? filters.category,
    sort: filters.sort,
    limit: pageSize,
  } satisfies StoreProductQuery
  // Keep the current grid on screen while a new filter loads instead of flashing back to skeletons.
  const products = useInfiniteQuery({
    queryKey: storeProductCatalogQueryKey(query),
    queryFn: ({ pageParam }) => getStoreProducts({ ...query, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  })
  const items = products.data?.pages.flatMap(page => page.items) ?? []
  const failed = products.isError && !products.isFetchNextPageError
  const refreshing = products.isPlaceholderData || (filters.q ?? '') !== (q ?? '')
  const scope = useProductMotion('catalog')

  function resetFilters() {
    setParams({}, { preventScrollReset: true })
  }

  return (
    <div ref={scope} className="@container/catalog w-full max-w-full">
      <title>{`${title} | suannn`}</title>
      <section aria-label={title}>
        <div className="grid gap-3 @min-[900px]/catalog:grid-cols-[176px_minmax(0,1fr)] @min-[900px]/catalog:gap-8">
          <CatalogFilters fixedCategory={fixedCategory} />
          <section aria-label="รายการสินค้า" className="min-w-0">
            <CatalogToolbar count={items.length} pending={products.isPending} fetching={refreshing} failed={failed} />
            {products.isPending && <ProductGridSkeleton appearance="catalog" className={gridClassName} label="กำลังโหลดรายการสินค้า" />}
            {failed && <div role="alert" className="flex flex-col items-start gap-3 py-8">
              <p className="font-medium">โหลดรายการสินค้าไม่ได้ กรุณาลองอีกครั้ง</p>
              <Button variant="outline" onClick={() => void products.refetch()}>ลองอีกครั้ง</Button>
            </div>}
            {products.data && !items.length && !refreshing && <Empty className="py-16">
              <EmptyHeader><EmptyTitle>ไม่พบสินค้า</EmptyTitle><EmptyDescription>ลองเปลี่ยนคำค้นหาหรือกลับไปดูสินค้าทั้งหมด</EmptyDescription></EmptyHeader>
              <EmptyContent>
                {fixedCategory
                  ? <Link className={buttonVariants({ variant: 'outline' })} to="/products">ดูสินค้าทั้งหมด</Link>
                  : <Button variant="outline" onClick={resetFilters}>ล้างตัวกรอง</Button>}
              </EmptyContent>
            </Empty>}
            {items.length ? <div aria-busy={refreshing} className={cn(gridClassName, 'transition-opacity duration-200', refreshing && 'opacity-60')}>
              {items.map(product => <ProductCard key={product.id} product={product} appearance="catalog" />)}
            </div> : null}
            {products.hasNextPage && !refreshing && <div className="mt-8 flex justify-center">
              <Button variant="outline" className="px-6" disabled={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()}>
                <ButtonSpinner show={products.isFetchingNextPage} />
                {products.isFetchingNextPage ? 'กำลังโหลด...' : 'ดูสินค้าเพิ่มเติม'}
              </Button>
            </div>}
            {products.isFetchNextPageError && <p role="alert" className="mt-4 text-center text-sm text-destructive">โหลดสินค้าเพิ่มเติมไม่ได้ ลองกดอีกครั้ง</p>}
          </section>
        </div>
      </section>
    </div>
  )
}

export function Component() {
  return <ProductCatalog />
}
