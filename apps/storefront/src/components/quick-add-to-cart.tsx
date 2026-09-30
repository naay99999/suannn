import { Button } from '@workspace/ui/components/button'
import { Link } from 'react-router'
import type { StoreProductSummary } from '@/lib/store-products'

export function QuickAddToCart({ product, className }: { product: StoreProductSummary; className?: string }) {
  return (
    <Button size="lg" className={className} render={<Link to={`/products/${product.slug}`} />}>
      {product.canPurchase ? 'ดูรายละเอียดและสั่งซื้อ' : 'ดูรายละเอียดสินค้า'}
    </Button>
  )
}
