import { useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft02Icon, ArrowRight02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@workspace/ui/components/button'
import { ProductCard } from '@/components/product-card'
import type { Product } from '@/lib/catalog'

export function RelatedProductsCarousel({ products }: { products: Product[] }) {
  const track = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  function goTo(index: number) {
    const container = track.current
    const item = container?.children.item(index) as HTMLElement | null
    const first = container?.firstElementChild as HTMLElement | null
    if (!container || !item || !first) return
    container.scrollTo({
      left: item.offsetLeft - first.offsetLeft,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
    setActive(index)
  }

  function updateActive() {
    const container = track.current
    const first = container?.firstElementChild as HTMLElement | null
    if (!container || !first) return
    if (container.scrollLeft + container.clientWidth >= container.scrollWidth - 2) {
      setActive(products.length - 1)
      return
    }
    const positions = Array.from(container.children, child => (child as HTMLElement).offsetLeft - first.offsetLeft)
    const nearest = positions.reduce((best, position, index) =>
      Math.abs(position - container.scrollLeft) < Math.abs(positions[best] - container.scrollLeft) ? index : best, 0)
    setActive(nearest)
  }

  return (
    <div role="region" aria-roledescription="carousel" aria-label="สินค้าอื่นที่น่าสนใจ">
      <div ref={track} onScroll={updateActive} className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-5 scroll-smooth motion-reduce:scroll-auto md:gap-6">
        {products.map((product, index) => (
          <div key={product.id} role="group" aria-roledescription="slide" aria-label={`${index + 1} จาก ${products.length}`} className="min-w-0 flex-none basis-[82%] snap-start sm:basis-[46%] lg:basis-[30%]">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-4">
        <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">{active + 1} / {products.length}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="icon-lg" className="size-11 rounded-full" aria-label="สินค้าก่อนหน้า" disabled={active === 0} onClick={() => goTo(active - 1)}><HugeiconsIcon icon={ArrowLeft02Icon} /></Button>
          <Button variant="outline" size="icon-lg" className="size-11 rounded-full" aria-label="สินค้าถัดไป" disabled={active === products.length - 1} onClick={() => goTo(active + 1)}><HugeiconsIcon icon={ArrowRight02Icon} /></Button>
        </div>
      </div>
    </div>
  )
}
