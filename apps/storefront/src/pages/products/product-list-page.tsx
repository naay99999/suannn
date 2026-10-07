import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { ProductCard } from '@/components/product-card'
import { getStoreProducts, readCatalogFilters, storeProductQueryKey, type StoreProductQuery } from '@/lib/store-products'
import { CatalogFilters, CatalogToolbar } from './_components/catalog-filters'
import { useProductMotion } from './_components/use-product-motion'

const pageSize = 24
const gridClassName = 'grid grid-flow-dense grid-cols-1 gap-x-3 gap-y-7 @min-[320px]/catalog:grid-cols-2 @min-[640px]/catalog:grid-cols-3 @min-[640px]/catalog:gap-x-5 @min-[950px]/catalog:grid-cols-4'

export function ProductCatalog({ fixedCategory, title = 'สินค้าจากสวน' }: { fixedCategory?: StoreProductQuery['category']; title?: string }) {
  const [params, setParams] = useSearchParams()
  const filters = readCatalogFilters(params)
  const query = {
    ...filters,
    ...(fixedCategory ? { category: fixedCategory } : {}),
    limit: pageSize,
    ...(params.get('cursor') ? { cursor: params.get('cursor')! } : {}),
  } satisfies StoreProductQuery
  const products = useQuery({ queryKey: storeProductQueryKey(query), queryFn: () => getStoreProducts(query) })
  const scope = useProductMotion('catalog')

  function resetFilters() {
    setParams({}, { preventScrollReset: true })
  }

  function loadNextPage() {
    if (!products.data?.nextCursor) return
    const next = new URLSearchParams(params)
    next.set('cursor', products.data.nextCursor)
    setParams(next, { preventScrollReset: true })
  }

  return (
    <div ref={scope} className="@container/catalog w-full max-w-full">
      <title>{`${title} | suannn`}</title>
      <section aria-labelledby="catalog-list-title">
        <header className="catalog-reveal mb-6 border-b pb-6">
          <h1 id="catalog-list-title" className="section-heading max-w-5xl">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">ผลไม้สดและของอร่อย เลือกที่ถูกใจได้เลย</p>
        </header>
        <div className="grid gap-5 @min-[900px]/catalog:grid-cols-[176px_minmax(0,1fr)] @min-[900px]/catalog:gap-8">
          <CatalogFilters fixedCategory={fixedCategory} />
          <section aria-label="รายการสินค้า" className="min-w-0">
            <CatalogToolbar count={products.data?.items.length ?? 0} pending={products.isPending} fetching={products.isFetching} failed={products.isError} />
            {products.isPending && <div aria-busy="true" aria-label="กำลังโหลดรายการสินค้า" className={gridClassName}>
              {Array.from({ length: 8 }, (_, index) => <div key={index} aria-hidden="true" className="flex flex-col gap-3 rounded-2xl border p-3">
                <Skeleton className="aspect-square w-full rounded-xl" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-11 w-full" />
              </div>)}
            </div>}
            {products.isError && <div role="alert" className="flex flex-col items-start gap-3 py-8">
              <p className="font-medium">โหลดรายการสินค้าไม่ได้ กรุณาลองอีกครั้ง</p>
              <Button variant="outline" className="min-h-11" onClick={() => void products.refetch()}>ลองอีกครั้ง</Button>
            </div>}
            {products.data && !products.data.items.length && <Empty className="py-16">
              <EmptyHeader><EmptyTitle>ไม่พบสินค้า</EmptyTitle><EmptyDescription>ลองเปลี่ยนคำค้นหาหรือกลับไปดูสินค้าทั้งหมด</EmptyDescription></EmptyHeader>
              <EmptyContent>
                {fixedCategory
                  ? <Link className={buttonVariants({ variant: 'outline', className: 'min-h-11' })} to="/products">ดูสินค้าทั้งหมด</Link>
                  : <Button variant="outline" className="min-h-11" onClick={resetFilters}>ล้างตัวกรอง</Button>}
              </EmptyContent>
            </Empty>}
            {products.data?.items.length ? <div className={gridClassName}>
              {products.data.items.map(product => <ProductCard key={product.id} product={product} appearance="catalog" />)}
            </div> : null}
            {products.data?.nextCursor && <div className="mt-8 flex justify-center">
              <Button variant="outline" className="min-h-11 px-6" disabled={products.isFetching} onClick={loadNextPage}>ดูสินค้าเพิ่มเติม</Button>
            </div>}
          </section>
        </div>
      </section>
      {!fixedCategory && <section className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t py-8">
        <div><h2 className="text-lg font-semibold">อร่อยขึ้น เมื่อรู้จักที่มา</h2><p className="mt-2 text-sm text-muted-foreground">ทำความรู้จักความตั้งใจที่เชื่อมคนกินกับคนปลูก</p></div>
        <Link className={buttonVariants({ variant: 'link', className: 'min-h-11 px-0' })} to="/#from-the-farm">จากสวนถึงคุณ</Link>
      </section>}
    </div>
  )
}

export function Component() {
  return <ProductCatalog />
}
