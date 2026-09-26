import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import { Badge } from '@workspace/ui/components/badge'
import { availabilityLabels, formatPrice, type Product } from '@/lib/catalog'
import { QuickAddToCart } from './quick-add-to-cart'

export function ProductCard({ product, showAddToCart = false }: { product: Product; showAddToCart?: boolean }) {
  const primaryImage = product.images[0]

  return (
    <article className="product-card group min-w-0 text-left">
      <Link to={`/products/${product.id}`} className="block rounded-3xl focus-visible:outline-2 focus-visible:outline-ring">
        <div className="relative aspect-[1/1.08] overflow-hidden rounded-3xl bg-muted">
          <img src={primaryImage.src} alt={primaryImage.alt} width={800} height={864} loading="lazy"
            className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 group-focus-visible:scale-105" />
          <Badge variant="secondary" className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] whitespace-normal">{product.categoryLabel}</Badge>
          <span className="glass-icon absolute bottom-3 right-3" aria-hidden="true">
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={20} />
          </span>
        </div>
        <div className="flex flex-col gap-2 px-1 pt-5">
          {product.imageNote && <p className="text-xs text-muted-foreground">{product.imageNote}</p>}
          <p className="text-xs text-muted-foreground">{product.english}</p>
          <h3 className="text-base font-semibold leading-relaxed lg:text-lg">{product.name}</h3>
          <p className="text-xs text-muted-foreground">{product.province} · {availabilityLabels[product.availability]}</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-lg font-semibold text-primary-ink">{formatPrice(product.price)}</span>
            <span className="text-xs text-muted-foreground">/ {product.unit} · ราคาตัวอย่าง</span>
          </div>
        </div>
      </Link>
      {showAddToCart && <QuickAddToCart product={product} className="mt-4 h-11 w-full rounded-full" />}
    </article>
  )
}
