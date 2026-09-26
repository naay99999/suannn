import { Link, useParams } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { buttonVariants } from '@workspace/ui/components/button'
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from '@workspace/ui/components/breadcrumb'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from '@workspace/ui/components/empty'
import { Separator } from '@workspace/ui/components/separator'
import { products, formatPrice, availabilityLabels } from '@/lib/catalog'
import { AddToCart } from './_components/add-to-cart'
import { ProductGallery } from './_components/product-gallery'
import { ProductInformation } from './_components/product-information'
import { RelatedProductsCarousel } from './_components/related-products-carousel'
import { useProductMotion } from './_components/use-product-motion'

export function Component() {
  const { id } = useParams()
  const product = products.find(item => item.id === id)
  const scope = useProductMotion(id ?? '')
  if (!product) return (
    <div ref={scope}>
      <title>ไม่พบสินค้า | suannn</title>
      <Empty className="min-h-[50svh]">
        <EmptyHeader><EmptyTitle><h1>ไม่พบสินค้าที่คุณกำลังมองหา</h1></EmptyTitle><EmptyDescription>รายการนี้อาจไม่มีอยู่ ลองเลือกของอร่อยจากรายการสินค้าของสวน</EmptyDescription></EmptyHeader>
        <EmptyContent><Link className={buttonVariants()} to="/products">กลับไปดูสินค้าทั้งหมด</Link></EmptyContent>
      </Empty>
    </div>
  )
  const related = products.filter(item => item.id !== product.id)
    .sort((a, b) => Number(b.category === product.category) - Number(a.category === product.category))
  const originWords = new Intl.Segmenter('th', { granularity: 'word' }).segment(product.origin)
  return (
    <div ref={scope}>
      <title>{`${product.name} | suannn`}</title>
      <Breadcrumb aria-label="เส้นทางหน้าสินค้า">
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink render={<Link to="/" />}>หน้าแรก</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink render={<Link to="/products" />}>สินค้า</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{product.name}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <section className="mt-8 grid items-start gap-9 lg:grid-cols-2 lg:gap-16" aria-labelledby="product-title">
        <ProductGallery key={product.id} product={product} />
        <div className="catalog-reveal py-2 lg:py-5">
          <Badge variant="secondary">{product.categoryLabel}</Badge>
          <p className="mt-6 text-xs tracking-widest text-muted-foreground">{product.english}</p>
          <h1 id="product-title" className="mt-3 max-w-3xl text-[clamp(2rem,3.2vw,3.25rem)] font-semibold leading-[1.4] tracking-tight">{product.name}</h1>
          <p className="mt-5 text-base leading-8 text-muted-foreground">{product.description}</p>
          <div className="my-7 flex flex-wrap items-baseline gap-3">
            <span className="text-4xl font-semibold text-primary-ink">{formatPrice(product.price)}</span>
            <span className="text-sm text-muted-foreground">/ {product.unit}</span>
          </div>
          <AddToCart key={`${product.id}-cart`} product={product} />
          <Separator />
          <dl className="my-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm leading-7">
            <dt className="text-muted-foreground">แหล่งผลิตตัวอย่าง</dt><dd>{product.farm} · {product.province}</dd>
            <dt className="text-muted-foreground">สถานะตัวอย่าง</dt><dd>{availabilityLabels[product.availability]}</dd>
            <dt className="text-muted-foreground">ขนาดบรรจุ</dt><dd>{product.unit}</dd>
          </dl>
          <p className="rounded-2xl bg-accent p-4 text-xs leading-6 text-muted-foreground">ราคา สถานะ ข้อมูลสวน และรายละเอียดสินค้านี้เป็นตัวอย่าง ยังไม่เปิดสั่งซื้อ ข้อมูลจริงจะยืนยันก่อนจำหน่าย</p>
          <ProductInformation key={`${product.id}-information`} product={product} />
        </div>
      </section>
      <section className="product-origin my-24 grid items-center gap-10 rounded-[2rem] bg-accent p-7 md:my-32 md:p-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16" aria-labelledby="origin-title">
        <div className="overflow-hidden rounded-3xl">
          <img src="/images/hero.jpg" alt="ดินและอุปกรณ์ทำสวน ภาพประกอบแนวคิดการรู้จักแหล่งที่มา ไม่ใช่ภาพสวนจริง" width={800} height={800} loading="lazy" className="origin-image aspect-square w-full object-cover" />
        </div>
        <div>
          <p className="mb-4 text-sm text-primary-ink">รู้จักคนปลูก ก่อนเลือกผลผลิต</p>
          <h2 id="origin-title" className="section-heading">ความตั้งใจ<br />จากต้นทางถึงคุณ</h2>
          <p className="mt-6 text-base leading-8">
            <span className="sr-only">{product.origin}</span>
            <span aria-hidden="true">{Array.from(originWords, (word, index) => <span key={index} className="origin-word">{word.segment}</span>)}</span>
          </p>
          <p className="mt-6 text-xs leading-6 text-muted-foreground">ชื่อสวน จังหวัด และภาพประกอบในส่วนนี้เป็นข้อมูลตัวอย่าง</p>
        </div>
      </section>
      <section aria-labelledby="related-title">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <h2 id="related-title" className="section-heading">ของอร่อยที่เข้ากัน</h2>
          <Link className={buttonVariants({ variant: 'link' })} to="/products">ดูสินค้าทั้งหมด</Link>
        </div>
        <RelatedProductsCarousel key={product.id} products={related} />
      </section>
    </div>
  )
}
