import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { ProductCard } from '@/components/product-card'
import { getStoreProducts, readCatalogFilters, storeProductQueryKey, type StoreProductQuery } from '@/lib/store-products'
import { CatalogFilters } from './_components/catalog-filters'
import { useProductMotion } from './_components/use-product-motion'

const pageSize = 24

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
    <div ref={scope} className="w-full max-w-full overflow-x-hidden">
      <title>{`${title} | suannn`}</title>
      <section aria-labelledby="catalog-list-title">
        <div className="mb-6">
          <h1 id="catalog-list-title" className="section-heading">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">ดูราคาและสถานะซื้อได้จากข้อมูลสินค้าปัจจุบัน</p>
        </div>
        <CatalogFilters count={products.data?.items.length ?? 0} fixedCategory={fixedCategory} />
        {products.isPending ? <p className="mt-8 text-muted-foreground" role="status">กำลังโหลดสินค้า...</p> : null}
        {products.isError ? (
          <div role="alert" className="mt-8 flex flex-wrap items-center gap-3">
            <p>โหลดรายการสินค้าไม่ได้ กรุณาลองอีกครั้ง</p>
            <Button variant="outline" onClick={() => void products.refetch()}>ลองอีกครั้ง</Button>
          </div>
        ) : null}
        {products.data && !products.data.items.length ? (
          <Empty className="my-12 border py-20">
            <EmptyHeader><EmptyTitle>ไม่พบสินค้า</EmptyTitle><EmptyDescription>ลองเปลี่ยนคำค้นหาหรือกลับไปดูสินค้าทั้งหมด</EmptyDescription></EmptyHeader>
            <EmptyContent>
              {fixedCategory
                ? <Link className={buttonVariants({ variant: 'outline' })} to="/products">ดูสินค้าทั้งหมด</Link>
                : <Button variant="outline" onClick={resetFilters}>ล้างตัวกรอง</Button>}
            </EmptyContent>
          </Empty>
        ) : null}
        {products.data?.items.length ? (
          <div className="catalog-grid mt-8 grid grid-flow-dense gap-x-5 gap-y-12 lg:gap-x-7">
            {products.data.items.map(product => <ProductCard key={product.id} product={product} />)}
          </div>
        ) : null}
        {products.data?.nextCursor ? (
          <div className="mt-10 flex justify-center">
            <Button variant="outline" size="lg" onClick={loadNextPage}>ดูสินค้าเพิ่มเติม</Button>
          </div>
        ) : null}
      </section>
      {!fixedCategory && <section className="catalog-closing mt-24 flex flex-col items-start justify-between gap-6 rounded-[2rem] bg-accent p-8 md:mt-32 md:flex-row md:items-center md:p-12">
        <div><h2 className="section-heading">อร่อยขึ้น เมื่อรู้จักที่มา</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">ทำความรู้จักความตั้งใจที่เชื่อมคนกินกับคนปลูก</p></div>
        <Link className={buttonVariants({ variant: 'outline', size: 'lg' })} to="/#from-the-farm">จากสวนถึงคุณ</Link>
      </section>}
    </div>
  )
}

export function Component() {
  return <ProductCatalog />
}
