import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { buttonVariants } from '@workspace/ui/components/button'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@workspace/ui/components/breadcrumb'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Field, FieldLabel } from '@workspace/ui/components/field'
import { Separator } from '@workspace/ui/components/separator'
import { getStoreProduct, getStoreProducts, formatStorePrice, storeCategoryLabels, storeProductDetailQueryKey, storeProductQueryKey, StoreProductRequestError } from '@/lib/store-products'
import { ProductGallery } from './_components/product-gallery'
import { ProductInformation } from './_components/product-information'
import { RelatedProductsCarousel } from './_components/related-products-carousel'
import { useProductMotion } from './_components/use-product-motion'

export function Component() {
  const { slug } = useParams()
  const scope = useProductMotion(slug ?? '')
  const product = useQuery({
    queryKey: storeProductDetailQueryKey(slug ?? ''),
    queryFn: () => getStoreProduct(slug!),
    enabled: Boolean(slug),
  })
  const [selectedVariantId, setSelectedVariantId] = useState('')
  const related = useQuery({
    queryKey: storeProductQueryKey({ category: product.data?.category, limit: 5 }),
    queryFn: () => getStoreProducts({ category: product.data!.category, limit: 5 }),
    enabled: Boolean(product.data),
  })

  if (product.isPending) return <p role="status" className="py-16 text-center text-muted-foreground">กำลังโหลดสินค้า...</p>
  if (product.isError && (product.error instanceof StoreProductRequestError && product.error.status === 404)) {
    return (
      <Empty className="min-h-[50svh]">
        <EmptyHeader><EmptyTitle><h1>ไม่พบสินค้าที่คุณกำลังมองหา</h1></EmptyTitle><EmptyDescription>สินค้านี้อาจยังไม่เปิดเผยหรือไม่มีอยู่ในร้าน</EmptyDescription></EmptyHeader>
        <EmptyContent><Link className={buttonVariants()} to="/products">กลับไปดูสินค้าทั้งหมด</Link></EmptyContent>
      </Empty>
    )
  }
  if (product.isError || !product.data) {
    return <div role="alert" className="flex flex-wrap items-center justify-center gap-3 py-16"><p>โหลดรายละเอียดสินค้าไม่ได้</p><button className={buttonVariants({ variant: 'outline' })} onClick={() => void product.refetch()}>ลองอีกครั้ง</button></div>
  }

  const item = product.data
  const selectedVariant = item.variants.find(variant => variant.id === selectedVariantId) ?? item.variants.find(variant => variant.canPurchase) ?? item.variants[0]
  const relatedProducts = related.data?.items.filter(candidate => candidate.slug !== item.slug) ?? []

  return (
    <div ref={scope}>
      <title>{`${item.name} | suannn`}</title>
      <Breadcrumb aria-label="เส้นทางหน้าสินค้า">
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink render={<Link to="/" />}>หน้าแรก</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink render={<Link to="/products" />}>สินค้า</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{item.name}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <section className="mt-8 grid items-start gap-9 lg:grid-cols-2 lg:gap-16" aria-labelledby="product-title">
        <ProductGallery key={item.id} product={item} />
        <div className="catalog-reveal py-2 lg:py-5">
          <Badge variant="secondary">{storeCategoryLabels[item.category]}</Badge>
          {item.englishName && <p className="mt-6 text-xs tracking-widest text-muted-foreground">{item.englishName}</p>}
          <h1 id="product-title" className="mt-3 max-w-3xl text-[clamp(2rem,3.2vw,3.25rem)] font-semibold leading-[1.4] tracking-tight">{item.name}</h1>
          {selectedVariant && <>
            <div className="my-7 flex flex-wrap items-baseline gap-3">
              <span className="text-4xl font-semibold text-primary-ink">{formatStorePrice(selectedVariant.priceSatang)}</span>
              <span className="text-sm text-muted-foreground">/ {selectedVariant.unit}</span>
            </div>
            {item.variants.length > 1 && <Field className="mb-5">
              <FieldLabel htmlFor="product-variant">ตัวเลือกสินค้า</FieldLabel>
              <select id="product-variant" className="h-11 rounded-xl border bg-background px-3" value={selectedVariant.id} onChange={event => setSelectedVariantId(event.target.value)}>
                {item.variants.map(variant => <option key={variant.id} value={variant.id}>{variant.name} · {formatStorePrice(variant.priceSatang)} / {variant.unit}{variant.canPurchase ? '' : ' · สั่งซื้อไม่ได้'}</option>)}
              </select>
            </Field>}
            <p role="status" className="mb-6 text-sm text-muted-foreground">{selectedVariant.canPurchase ? 'สินค้ารายการนี้พร้อมสั่งซื้อ' : 'สินค้ารายการนี้ยังไม่พร้อมสั่งซื้อ'}</p>
          </>}
          {!selectedVariant && <p role="status" className="my-7 text-sm text-muted-foreground">ขณะนี้ไม่มีตัวเลือกสินค้าที่เปิดจำหน่าย</p>}
          <Separator />
          <dl className="my-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm leading-7">
            <dt className="text-muted-foreground">หมวดหมู่</dt><dd>{storeCategoryLabels[item.category]}</dd>
            <dt className="text-muted-foreground">สถานะ</dt><dd>{item.canPurchase ? 'พร้อมสั่งซื้อ' : 'ขณะนี้ยังสั่งซื้อไม่ได้'}</dd>
          </dl>
          <ProductInformation product={item} />
        </div>
      </section>
      {related.isError ? <p role="status" className="mt-16 text-sm text-muted-foreground">โหลดสินค้าอื่นที่เกี่ยวข้องไม่ได้</p> : null}
      {relatedProducts.length > 0 && <section className="mt-20" aria-labelledby="related-title">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <h2 id="related-title" className="section-heading">สินค้าในหมวดเดียวกัน</h2>
          <Link className={buttonVariants({ variant: 'link' })} to={`/categories/${item.category}`}>ดูหมวดหมู่</Link>
        </div>
        <RelatedProductsCarousel key={item.id} products={relatedProducts} />
      </section>}
    </div>
  )
}
