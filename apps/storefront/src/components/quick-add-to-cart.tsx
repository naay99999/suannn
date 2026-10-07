import { buttonVariants } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { Link } from 'react-router'
import type { StoreProductSummary } from '@/lib/store-products'

export function QuickAddToCart({ product, className }: { product: StoreProductSummary; className?: string }) {
  return (
    <Link className={cn(buttonVariants({ size: 'lg' }), className)} to={`/products/${product.slug}`}>
      {product.canPurchase ? 'ดูรายละเอียดและสั่งซื้อ' : 'ดูรายละเอียดสินค้า'}
    </Link>
  )
}
