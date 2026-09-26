import { Link, useSearchParams } from 'react-router'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from '@workspace/ui/components/empty'
import { ProductCard } from '@/components/product-card'
import { filterProducts } from '@/lib/catalog'
import { CatalogFilters } from './_components/catalog-filters'
import { useProductMotion } from './_components/use-product-motion'

export function Component() {
  const [params, setParams] = useSearchParams()
  const products = filterProducts(params)
  const scope = useProductMotion('catalog')

  return (
    <div ref={scope} className="w-full max-w-full overflow-x-hidden">
      <title>ผลไม้และของอร่อยจากสวน | suannn</title>
      <section aria-labelledby="catalog-list-title">
        <div className="mb-6">
          <h1 id="catalog-list-title" className="section-heading">สินค้าจากสวน</h1>
          <p className="mt-2 text-sm text-muted-foreground">เลือกตามที่ชอบ แล้วเพิ่มลงตะกร้าได้จากหน้านี้</p>
        </div>
        <CatalogFilters count={products.length} />
        <p className="mt-5 text-xs leading-6 text-muted-foreground">รายการ ราคา สถานะ และข้อมูลสวนเป็นตัวอย่าง ยังไม่เปิดสั่งซื้อหรือชำระเงินจริง</p>
        {products.length ? (
          <div className="catalog-grid mt-8 grid grid-flow-dense gap-x-5 gap-y-12 lg:gap-x-7">
            {products.map(product => <ProductCard key={product.id} product={product} showAddToCart />)}
          </div>
        ) : (
          <Empty className="my-12 border py-20">
            <EmptyHeader><EmptyTitle>ยังไม่เจอของอร่อยที่ค้นหา</EmptyTitle><EmptyDescription>ลองเปลี่ยนคำค้น หรือเปิดดูสินค้าทุกหมวดอีกครั้ง</EmptyDescription></EmptyHeader>
            <EmptyContent><Button variant="outline" onClick={() => setParams({})}>ดูสินค้าทั้งหมด</Button></EmptyContent>
          </Empty>
        )}
      </section>
      <section className="catalog-closing mt-24 flex flex-col items-start justify-between gap-6 rounded-[2rem] bg-accent p-8 md:mt-32 md:flex-row md:items-center md:p-12">
        <div><h2 className="section-heading">อร่อยขึ้น เมื่อรู้จักที่มา</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">ทำความรู้จักความตั้งใจที่เชื่อมคนกินกับคนปลูก</p></div>
        <Link className={buttonVariants({ variant: 'outline', size: 'lg' })} to="/#from-the-farm">จากสวนถึงคุณ</Link>
      </section>
    </div>
  )
}
