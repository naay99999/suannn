import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import { Badge } from '@workspace/ui/components/badge'
import { cn } from '@workspace/ui/lib/utils'
import { formatStorePrice, storeCategoryLabels, type StoreProductSummary } from '@/lib/store-products'
import { StoreProductImage } from './store-product-image'
import { CatalogCartAction } from './catalog-cart-action'

export function ProductCard({ product, appearance = 'default' }: { product: StoreProductSummary; appearance?: 'default' | 'catalog' }) {
  const catalog = appearance === 'catalog'
  return (
    <article className={cn('product-card group min-w-0 text-left', catalog && 'flex flex-col rounded-2xl border bg-card p-2.5 transition-colors duration-200 hover:border-primary/40 focus-within:border-primary/40 sm:p-3')}>
      <Link to={`/products/${product.slug}`} className={cn('focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring', catalog ? 'flex w-full min-w-0 flex-1 flex-col rounded-xl' : 'block rounded-3xl')}>
        <div className={cn('relative overflow-hidden bg-muted', catalog ? 'aspect-square rounded-xl' : 'aspect-[1/1.08] rounded-3xl')}>
          <StoreProductImage src={product.imageUrl} alt={product.imageAlt ?? product.name} className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-105 group-focus-within:scale-105 motion-reduce:transform-none" />
          {!catalog && <Badge variant="secondary" className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] whitespace-normal">{storeCategoryLabels[product.category]}</Badge>}
          {!catalog && <span className="glass-icon absolute bottom-3 right-3" aria-hidden="true">
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={20} />
          </span>}
        </div>
        <div className={cn('flex flex-col gap-2', catalog ? 'flex-1 pt-4' : 'px-1 pt-5')}>
          {catalog && <p className="text-xs text-muted-foreground">{storeCategoryLabels[product.category]}</p>}
          {product.englishName && <p className="text-xs text-muted-foreground">{product.englishName}</p>}
          <h3 className={cn('font-semibold', catalog ? 'min-h-12 text-sm leading-6 sm:text-base' : 'text-base leading-relaxed lg:text-lg')}>{product.name}</h3>
          <p className={cn('text-xs text-muted-foreground', catalog && product.canPurchase && 'text-primary-ink')}>{product.canPurchase ? 'พร้อมสั่งซื้อ' : 'ขณะนี้ยังสั่งซื้อไม่ได้'}</p>
          <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', catalog ? 'mt-auto pt-2' : 'mt-2')}>
            <span className="text-lg font-semibold tabular-nums text-primary-ink">{formatStorePrice(product.minPriceSatang)}</span>
          </div>
        </div>
      </Link>
      {catalog && <CatalogCartAction product={product} />}
    </article>
  )
}
