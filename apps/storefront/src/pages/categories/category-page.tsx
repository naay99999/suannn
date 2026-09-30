import { Link, useParams } from 'react-router'
import { buttonVariants } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { ProductCatalog } from '@/pages/products/product-list-page'
import { readStoreCategorySlug } from '@/lib/store-products'

export function Component() {
  const { slug } = useParams()
  const category = readStoreCategorySlug(slug)

  if (!category) {
    return (
      <Empty className="min-h-[50svh]">
        <EmptyHeader><EmptyTitle><h1>ไม่พบหมวดหมู่สินค้า</h1></EmptyTitle><EmptyDescription>หมวดหมู่นี้ไม่มีอยู่ในรายการของร้าน</EmptyDescription></EmptyHeader>
        <EmptyContent><Link className={buttonVariants({ variant: 'outline' })} to="/products">กลับไปดูสินค้าทั้งหมด</Link></EmptyContent>
      </Empty>
    )
  }

  return <ProductCatalog fixedCategory={category} title={category === 'fresh' ? 'ผลไม้สด' : 'ผลิตภัณฑ์แปรรูป'} />
}
