import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import { Badge } from '@workspace/ui/components/badge'
import { formatStorePrice, storeCategoryLabels, type StoreProductSummary } from '@/lib/store-products'
import { StoreProductImage } from './store-product-image'

export function ProductCard({ product }: { product: StoreProductSummary }) {
  return (
    <article className="product-card group min-w-0 text-left">
      <Link to={`/products/${product.slug}`} className="block rounded-3xl focus-visible:outline-2 focus-visible:outline-ring">
        <div className="relative aspect-[1/1.08] overflow-hidden rounded-3xl bg-muted">
          <StoreProductImage src={product.imageUrl} alt={product.imageAlt ?? product.name} className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 group-focus-visible:scale-105" />
          <Badge variant="secondary" className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] whitespace-normal">{storeCategoryLabels[product.category]}</Badge>
          <span className="glass-icon absolute bottom-3 right-3" aria-hidden="true">
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={20} />
          </span>
        </div>
        <div className="flex flex-col gap-2 px-1 pt-5">
          {product.englishName && <p className="text-xs text-muted-foreground">{product.englishName}</p>}
          <h3 className="text-base font-semibold leading-relaxed lg:text-lg">{product.name}</h3>
          <p className="text-xs text-muted-foreground">{product.canPurchase ? 'พร้อมสั่งซื้อ' : 'ขณะนี้ยังสั่งซื้อไม่ได้'}</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-lg font-semibold text-primary-ink">{formatStorePrice(product.minPriceSatang)}</span>
          </div>
        </div>
      </Link>
    </article>
  )
}
