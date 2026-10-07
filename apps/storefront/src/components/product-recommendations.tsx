import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft02Icon, ArrowRight02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { ProductCard } from '@/components/product-card'
import type { StoreProductSummary } from '@/lib/store-products'

export const recommendationLimit = 8
const largeGridQuery = '(min-width: 1280px) and (orientation: landscape)'
const mediumGridQuery = '(min-width: 1024px) and (orientation: landscape)'

function readColumns() {
  if (window.matchMedia(largeGridQuery).matches) return 4
  if (window.matchMedia(mediumGridQuery).matches) return 3
  return 0
}

function subscribeLayout(onChange: () => void) {
  const queries = [largeGridQuery, mediumGridQuery].map(query => window.matchMedia(query))
  queries.forEach(query => query.addEventListener('change', onChange))
  return () => queries.forEach(query => query.removeEventListener('change', onChange))
}

export function ProductRecommendations({ products, label }: { products: StoreProductSummary[]; label: string }) {
  const columns = useSyncExternalStore(subscribeLayout, readColumns, () => 0)
  const isCarousel = columns === 0
  const visibleProducts = products.slice(0, columns ? columns * 2 : recommendationLimit)
  const track = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ active: 0, atStart: true, atEnd: false })

  function updatePosition() {
    const container = track.current
    const first = container?.firstElementChild as HTMLElement | null
    if (!container || !first) return
    const positions = Array.from(container.children, child => (child as HTMLElement).offsetLeft - first.offsetLeft)
    const active = positions.reduce((best, left, index) =>
      Math.abs(left - container.scrollLeft) < Math.abs(positions[best]! - container.scrollLeft) ? index : best, 0)
    setPosition({
      active,
      atStart: container.scrollLeft <= 2,
      atEnd: container.scrollLeft + container.clientWidth >= container.scrollWidth - 2,
    })
  }

  useEffect(() => {
    if (!isCarousel) return
    const container = track.current
    if (!container) return
    container.scrollLeft = 0
    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    observer.observe(container)
    return () => observer.disconnect()
  }, [isCarousel, products])

  function goTo(index: number) {
    const container = track.current
    const item = container?.children.item(index) as HTMLElement | null
    const first = container?.firstElementChild as HTMLElement | null
    if (!container || !item || !first) return
    container.scrollTo({
      left: Math.min(item.offsetLeft - first.offsetLeft, container.scrollWidth - container.clientWidth),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }

  if (!visibleProducts.length) return null

  return (
    <div role="region" aria-roledescription={isCarousel ? 'carousel' : undefined} aria-label={label}>
      <div
        ref={track}
        onScroll={isCarousel ? updatePosition : undefined}
        tabIndex={isCarousel ? 0 : undefined}
        aria-label={isCarousel ? 'เลื่อนดูสินค้า' : undefined}
        onKeyDown={isCarousel ? event => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'ArrowRight' && !position.atEnd) { event.preventDefault(); goTo(position.active + 1) }
          if (event.key === 'ArrowLeft' && !position.atStart) { event.preventDefault(); goTo(position.active - 1) }
        } : undefined}
        className={cn(
          isCarousel
            ? 'flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-5 scroll-smooth motion-reduce:scroll-auto sm:gap-6'
            : 'grid gap-x-5 gap-y-10',
          columns === 4 && 'grid-cols-4',
          columns === 3 && 'grid-cols-3',
        )}
      >
        {visibleProducts.map((product, index) => (
          <div key={product.id} role={isCarousel ? 'group' : undefined} aria-roledescription={isCarousel ? 'slide' : undefined} aria-label={isCarousel ? `${index + 1} จาก ${visibleProducts.length}` : undefined} className={cn('min-w-0', isCarousel && 'flex-none basis-[82%] snap-start sm:basis-[46%]')}>
            <ProductCard product={product} />
          </div>
        ))}
      </div>
      {isCarousel ? <div className="mt-2 flex items-center justify-between gap-4">
        <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">{position.active + 1} / {visibleProducts.length}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="icon-lg" className="size-11 rounded-full" aria-label="สินค้าก่อนหน้า" disabled={position.atStart} onClick={() => goTo(position.active - 1)}><HugeiconsIcon icon={ArrowLeft02Icon} /></Button>
          <Button variant="outline" size="icon-lg" className="size-11 rounded-full" aria-label="สินค้าถัดไป" disabled={position.atEnd} onClick={() => goTo(position.active + 1)}><HugeiconsIcon icon={ArrowRight02Icon} /></Button>
        </div>
      </div> : <p role="status" className="mt-7 text-xs leading-6 text-muted-foreground">แสดง {visibleProducts.length} รายการ</p>}
    </div>
  )
}
