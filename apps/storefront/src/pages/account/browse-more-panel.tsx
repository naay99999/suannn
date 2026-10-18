import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft02Icon, ArrowRight01Icon, ArrowRight02Icon } from '@hugeicons/core-free-icons'
import { A11y } from 'swiper/modules'
import type { Swiper as SwiperInstance } from 'swiper'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Button } from '@workspace/ui/components/button'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { cn } from '@workspace/ui/lib/utils'
import { useCart } from '@/components/cart/cart-context'
import { CatalogCartAction } from '@/components/catalog-cart-action'
import { StoreProductImage } from '@/components/store-product-image'
import { standaloneTextLink } from './account-styles'
import { formatStorePrice, getStoreProducts, storeProductQueryKey, type StoreProductSummary } from '@/lib/store-products'

import 'swiper/css'

const browsePickLimit = 8
// Over-fetch so products already in the cart can be dropped without thinning the carousel.
const browseFetchLimit = 16
const slideClassName = '!h-auto !w-[42%] sm:!w-[30%] lg:!w-[22%]'

export function BrowseMorePanel({ title, description }: { title: string; description: string }) {
  const { cart } = useCart()
  // Products in the cart on arrival are hidden; ones added here stay put so their quantity control remains usable.
  const [hiddenProductIds, setHiddenProductIds] = useState<ReadonlySet<string> | null>(null)
  if (hiddenProductIds === null && cart) setHiddenProductIds(new Set(cart.lines.flatMap(line => line.productId ? [line.productId] : [])))
  const products = useQuery({
    queryKey: storeProductQueryKey({ sort: 'newest', limit: browseFetchLimit }),
    queryFn: () => getStoreProducts({ sort: 'newest', limit: browseFetchLimit }),
  })
  const picks = (products.data?.items ?? []).filter(product => !hiddenProductIds?.has(product.id)).slice(0, browsePickLimit)

  return (
    <section className="flex min-w-0 flex-col items-stretch gap-5 rounded-surface bg-accent p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <Link to="/products" className={cn(standaloneTextLink, 'group/all shrink-0 text-sm')}>
          ดูสินค้าทั้งหมด <HugeiconsIcon icon={ArrowRight01Icon} className="size-4 transition-transform group-hover/all:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </Link>
      </div>
      {products.isPending ? <div role="status" aria-label="กำลังโหลดสินค้า" className="flex gap-3 overflow-hidden">
        {[0, 1, 2, 3].map(index => <div key={index} className="flex w-[42%] shrink-0 flex-col gap-2 sm:w-[30%] lg:w-[22%]"><Skeleton className="aspect-square rounded-field" /><Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>)}
      </div> : picks.length > 0 && <PicksCarousel products={picks} />}
    </section>
  )
}

function PicksCarousel({ products }: { products: StoreProductSummary[] }) {
  const swiperRef = useRef<SwiperInstance | null>(null)
  const [position, setPosition] = useState({ atStart: true, atEnd: false, locked: false })

  function syncPosition(swiper: SwiperInstance) {
    setPosition({ atStart: swiper.isBeginning || swiper.isLocked, atEnd: swiper.isEnd || swiper.isLocked, locked: swiper.isLocked })
  }

  return (
    <div role="region" aria-roledescription="carousel" aria-label="สินค้าใหม่จากสวน" className="min-w-0">
      {/* Swiper treats on* props as its own events, so keyboard handling lives on this wrapper. */}
      <div
        tabIndex={0}
        aria-label="เลื่อนดูสินค้า"
        className="rounded-field focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'ArrowRight' && !position.atEnd) { event.preventDefault(); swiperRef.current?.slideNext() }
          if (event.key === 'ArrowLeft' && !position.atStart) { event.preventDefault(); swiperRef.current?.slidePrev() }
        }}
      >
        <Swiper
          modules={[A11y]}
          slidesPerView="auto"
          spaceBetween={12}
          watchOverflow
          speed={300}
          a11y={{ itemRoleDescriptionMessage: 'slide', slideLabelMessage: '{{index}} จาก {{slidesLength}}' }}
          onSwiper={swiper => {
            swiperRef.current = swiper
            syncPosition(swiper)
          }}
          onSlideChange={syncPosition}
          onResize={syncPosition}
          onReachEnd={syncPosition}
          onReachBeginning={syncPosition}
          onLock={syncPosition}
          onUnlock={syncPosition}
        >
          {products.map(product => <SwiperSlide key={product.id} className={slideClassName}>
            <Link to={`/products/${product.slug}`} className="group flex flex-col gap-2 rounded-field focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
              <div className="aspect-square overflow-hidden rounded-field bg-background">
                <StoreProductImage src={product.imageUrl} alt={product.imageAlt ?? product.name} className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-105 motion-reduce:transform-none" />
              </div>
              <span className="truncate text-sm font-medium">{product.name}</span>
              <span className="-mt-1.5 text-sm font-semibold tabular-nums text-primary-ink">{formatStorePrice(product.minPriceSatang)}</span>
            </Link>
            <CatalogCartAction product={product} />
          </SwiperSlide>)}
        </Swiper>
      </div>
      {!position.locked && <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="icon-lg" aria-label="สินค้าก่อนหน้า" disabled={position.atStart} onClick={() => swiperRef.current?.slidePrev()}><HugeiconsIcon icon={ArrowLeft02Icon} /></Button>
        <Button variant="outline" size="icon-lg" aria-label="สินค้าถัดไป" disabled={position.atEnd} onClick={() => swiperRef.current?.slideNext()}><HugeiconsIcon icon={ArrowRight02Icon} /></Button>
      </div>}
    </div>
  )
}
