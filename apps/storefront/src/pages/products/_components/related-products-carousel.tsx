import { useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft02Icon, ArrowRight02Icon } from '@hugeicons/core-free-icons'
import { A11y } from 'swiper/modules'
import type { Swiper as SwiperInstance } from 'swiper'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Button } from '@workspace/ui/components/button'
import { ProductCard } from '@/components/product-card'
import type { StoreProductSummary } from '@/lib/store-products'

import 'swiper/css'

export const relatedProductLimit = 8

export function RelatedProductsCarousel({ products }: { products: StoreProductSummary[] }) {
  const swiperRef = useRef<SwiperInstance | null>(null)
  const [position, setPosition] = useState({ active: 0, atStart: true, atEnd: false })

  function syncPosition(swiper: SwiperInstance) {
    // With several cards in view the last slides never become active, so the end reports the final card.
    setPosition({
      active: swiper.isEnd && !swiper.isLocked ? products.length - 1 : swiper.activeIndex,
      atStart: swiper.isBeginning || swiper.isLocked,
      atEnd: swiper.isEnd || swiper.isLocked,
    })
  }

  if (!products.length) return null

  return (
    <div role="region" aria-roledescription="carousel" aria-label="สินค้าอื่นที่น่าสนใจ">
      {/* Swiper treats on* props as its own events, so keyboard handling lives on this wrapper. */}
      <div
        tabIndex={0}
        aria-label="เลื่อนดูสินค้า"
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'ArrowRight' && !position.atEnd) { event.preventDefault(); swiperRef.current?.slideNext() }
          if (event.key === 'ArrowLeft' && !position.atStart) { event.preventDefault(); swiperRef.current?.slidePrev() }
        }}
      >
        <Swiper
          modules={[A11y]}
          slidesPerView="auto"
          spaceBetween={16}
          breakpoints={{ 640: { spaceBetween: 24 } }}
          watchOverflow
          speed={300}
          a11y={{
            itemRoleDescriptionMessage: 'slide',
            slideLabelMessage: '{{index}} จาก {{slidesLength}}',
          }}
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
          className="related-products-swiper pb-5"
        >
          {products.map(product => (
            <SwiperSlide key={product.id} className="!h-auto !w-[82%] sm:!w-[calc((100%-1.5rem)/2)] lg:!w-[calc((100%-4.5rem)/4)]">
              <ProductCard product={product} />
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
      <div className="mt-2 flex items-center justify-between gap-4">
        <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">{position.active + 1} / {products.length}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="icon-lg" className="size-11 rounded-full" aria-label="สินค้าก่อนหน้า" disabled={position.atStart} onClick={() => swiperRef.current?.slidePrev()}><HugeiconsIcon icon={ArrowLeft02Icon} /></Button>
          <Button variant="outline" size="icon-lg" className="size-11 rounded-full" aria-label="สินค้าถัดไป" disabled={position.atEnd} onClick={() => swiperRef.current?.slideNext()}><HugeiconsIcon icon={ArrowRight02Icon} /></Button>
        </div>
      </div>
    </div>
  )
}
