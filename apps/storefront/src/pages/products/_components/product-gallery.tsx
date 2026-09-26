import { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft02Icon, ArrowRight02Icon, Maximize01Icon } from '@hugeicons/core-free-icons'
import { A11y } from 'swiper/modules'
import type { Swiper as SwiperInstance } from 'swiper'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Button } from '@workspace/ui/components/button'
import type { Product } from '@/lib/catalog'
import { ProductGalleryImage } from './product-gallery-image'
import { ProductGalleryThumbnails } from './product-gallery-thumbnails'
import { ProductGalleryViewer } from './product-gallery-viewer'

import 'swiper/css'

export function ProductGallery({ product }: { product: Product }) {
  const mainSwiper = useRef<SwiperInstance | null>(null)
  const imageTriggerRefs = useRef<Array<HTMLButtonElement | null>>([])
  const wasViewerOpen = useRef(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    if (viewerOpen) {
      wasViewerOpen.current = true
      return
    }

    mainSwiper.current?.slideTo(activeIndex, 0, false)
    if (!wasViewerOpen.current) return

    wasViewerOpen.current = false
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        imageTriggerRefs.current[activeIndex]?.focus({ preventScroll: true })
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeIndex, viewerOpen])

  function markImageFailed(src: string) {
    setFailedSources(current => {
      if (current.has(src)) return current
      return new Set(current).add(src)
    })
  }

  function selectImage(index: number) {
    mainSwiper.current?.slideTo(index)
  }

  return (
    <div role="group" aria-label={`ภาพสินค้า: ${product.name}`} className="product-gallery catalog-reveal min-w-0">
      <div className="relative overflow-hidden rounded-[1.5rem] bg-muted md:rounded-[2rem]">
        <Swiper
          modules={[A11y]}
          slidesPerView={1}
          loop={false}
          watchOverflow
          speed={300}
          a11y={{
            containerRole: 'region',
            containerMessage: `ภาพของ${product.name}`,
            containerRoleDescriptionMessage: 'แกลเลอรีภาพสินค้า',
            itemRoleDescriptionMessage: 'ภาพสินค้า',
            slideLabelMessage: 'ภาพ {{index}} จาก {{slidesLength}}',
          }}
          onSwiper={swiper => { mainSwiper.current = swiper }}
          onSlideChange={swiper => setActiveIndex(swiper.activeIndex)}
          className="product-gallery-main"
        >
          {product.images.map((image, index) => (
            <SwiperSlide key={image.src}>
              <div className="relative aspect-square overflow-hidden bg-muted md:aspect-[1.08/1]">
                <button
                  type="button"
                  ref={element => { imageTriggerRefs.current[index] = element }}
                  aria-label={`เปิดภาพเต็มจอ ${index + 1}: ${image.alt}`}
                  onClick={() => setViewerOpen(true)}
                  className="absolute inset-0 size-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-ring"
                >
                  <ProductGalleryImage
                    src={image.src}
                    alt={image.alt}
                    failed={failedSources.has(image.src)}
                    onImageError={markImageFailed}
                    fetchPriority={index === 0 ? 'high' : undefined}
                    loading={index === 0 ? 'eager' : 'lazy'}
                    decoding="async"
                    width={1254}
                    height={1254}
                    className="size-full object-cover"
                  />
                  <span className="glass-icon absolute bottom-4 right-4 size-11" aria-hidden="true">
                    <HugeiconsIcon icon={Maximize01Icon} size={20} />
                  </span>
                </button>
                <span className="glass-label pointer-events-none absolute bottom-4 left-4 max-w-[calc(100%-5rem)] text-xs">
                  {image.caption}
                </span>
              </div>
            </SwiperSlide>
          ))}
        </Swiper>

        {product.images.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon-lg"
              className="absolute left-3 top-1/2 z-10 hidden size-11 -translate-y-1/2 rounded-full bg-background/85 md:grid"
              aria-label="ภาพก่อนหน้า"
              disabled={activeIndex === 0}
              onClick={() => selectImage(activeIndex - 1)}
            >
              <HugeiconsIcon icon={ArrowLeft02Icon} />
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              className="absolute right-3 top-1/2 z-10 hidden size-11 -translate-y-1/2 rounded-full bg-background/85 md:grid"
              aria-label="ภาพถัดไป"
              disabled={activeIndex === product.images.length - 1}
              onClick={() => selectImage(activeIndex + 1)}
            >
              <HugeiconsIcon icon={ArrowRight02Icon} />
            </Button>
            <span className="absolute right-4 top-4 z-10 rounded-full bg-background/85 px-3 py-1.5 text-xs tabular-nums text-foreground" aria-live="polite">
              {activeIndex + 1} / {product.images.length}
            </span>
          </>
        )}
      </div>

      {product.images.length > 1 && (
        <div className="mt-3">
          <ProductGalleryThumbnails
            images={product.images}
            activeIndex={activeIndex}
            onSelect={selectImage}
          />
        </div>
      )}

      <ProductGalleryViewer
        product={product}
        open={viewerOpen}
        activeIndex={activeIndex}
        failedSources={failedSources}
        onOpenChange={setViewerOpen}
        onActiveIndexChange={setActiveIndex}
        onImageError={markImageFailed}
      />
    </div>
  )
}
