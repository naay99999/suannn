import { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft02Icon, ArrowRight02Icon, Cancel01Icon, ZoomInAreaIcon, ZoomOutAreaIcon } from '@hugeicons/core-free-icons'
import { A11y, Zoom } from 'swiper/modules'
import type { Swiper as SwiperInstance } from 'swiper'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@workspace/ui/components/dialog'
import type { Product } from '@/lib/catalog'
import { ProductGalleryImage } from './product-gallery-image'
import { ProductGalleryThumbnails } from './product-gallery-thumbnails'

import 'swiper/css'
import 'swiper/css/zoom'

interface ProductGalleryViewerProps {
  product: Product
  open: boolean
  activeIndex: number
  failedSources: ReadonlySet<string>
  onOpenChange: (open: boolean) => void
  onActiveIndexChange: (index: number) => void
  onImageError: (src: string) => void
}

export function ProductGalleryViewer({
  product,
  open,
  activeIndex,
  failedSources,
  onOpenChange,
  onActiveIndexChange,
  onImageError,
}: ProductGalleryViewerProps) {
  const swiperRef = useRef<SwiperInstance | null>(null)
  const [zoomScale, setZoomScale] = useState(1)
  const currentImage = product.images[activeIndex]
  const currentImageFailed = failedSources.has(currentImage.src)

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      swiperRef.current?.update()
      swiperRef.current?.slideTo(activeIndex, 0, false)
    })
    return () => cancelAnimationFrame(frame)
  }, [open, activeIndex])

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      onActiveIndexChange(swiperRef.current?.activeIndex ?? activeIndex)
      setZoomScale(1)
    }
    onOpenChange(nextOpen)
  }

  function changeSlide(index: number) {
    swiperRef.current?.slideTo(index)
  }

  function zoomIn() {
    const swiper = swiperRef.current
    if (!swiper || currentImageFailed) return
    swiper.zoom.in(Math.min(2, Math.max(1, swiper.zoom.scale) + 0.5))
  }

  function zoomOut() {
    swiperRef.current?.zoom.out()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="suannn-store fixed inset-0 top-0 left-0 z-[60] grid grid-cols-1 grid-rows-1 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-neutral-950 p-0 text-white ring-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">ดูภาพสินค้า: {product.name}</DialogTitle>
        <DialogDescription className="sr-only">
          ปัดเพื่อเปลี่ยนภาพ แตะสองครั้งหรือใช้สองนิ้วเพื่อซูม และใช้ปุ่มลูกศรเพื่อดูภาพก่อนหน้าหรือถัดไป
        </DialogDescription>
        <div
          className="relative flex min-h-0 h-full min-w-0 flex-col"
          onKeyDownCapture={event => {
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              swiperRef.current?.slidePrev()
            } else if (event.key === 'ArrowRight') {
              event.preventDefault()
              swiperRef.current?.slideNext()
            }
          }}
        >
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-3 pt-[max(env(safe-area-inset-top),0.75rem)] sm:px-6">
            <Button
              variant="ghost"
              size="icon-lg"
              className="size-11 rounded-full text-white hover:bg-white/15 hover:text-white"
              aria-label="ปิดภาพเต็มจอ"
              onClick={() => handleOpenChange(false)}
            >
              <HugeiconsIcon icon={Cancel01Icon} />
            </Button>
            <p className="rounded-full bg-black/45 px-3 py-2 text-sm tabular-nums text-white" aria-live="polite">
              {activeIndex + 1} / {product.images.length}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11 rounded-full text-white hover:bg-white/15 hover:text-white"
                aria-label="ย่อภาพกลับ"
                onClick={zoomOut}
                disabled={currentImageFailed || zoomScale <= 1}
              >
                <HugeiconsIcon icon={ZoomOutAreaIcon} />
              </Button>
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11 rounded-full text-white hover:bg-white/15 hover:text-white"
                aria-label="ขยายภาพ"
                onClick={zoomIn}
                disabled={currentImageFailed || zoomScale >= 2}
              >
                <HugeiconsIcon icon={ZoomInAreaIcon} />
              </Button>
            </div>
          </div>

          <Swiper
            modules={[A11y, Zoom]}
            slidesPerView={1}
            loop={false}
            initialSlide={activeIndex}
            speed={300}
            zoom={{ enabled: true, maxRatio: 2, minRatio: 1, toggle: true }}
            a11y={{
              containerRole: 'region',
              containerMessage: `ภาพของ${product.name}`,
              containerRoleDescriptionMessage: 'แกลเลอรีภาพสินค้า',
              itemRoleDescriptionMessage: 'ภาพสินค้า',
              slideLabelMessage: 'ภาพ {{index}} จาก {{slidesLength}}',
            }}
            onSwiper={swiper => {
              swiperRef.current = swiper
              swiper.slideTo(activeIndex, 0, false)
            }}
            onSlideChange={swiper => {
              onActiveIndexChange(swiper.activeIndex)
              setZoomScale(1)
            }}
            onZoomChange={(_swiper, scale) => setZoomScale(scale)}
            className="product-gallery-viewer-swiper size-full"
          >
            {product.images.map((image, index) => (
              <SwiperSlide key={image.src} className="flex items-center justify-center">
                {failedSources.has(image.src) ? (
                  <ProductGalleryImage
                    src={image.src}
                    alt={image.alt}
                    failed
                    onImageError={onImageError}
                    className="h-full w-full"
                  />
                ) : (
                  <div className="swiper-zoom-container size-full" data-swiper-zoom="2">
                    <ProductGalleryImage
                      src={image.src}
                      alt={image.alt}
                      failed={false}
                      onImageError={onImageError}
                      loading={index === activeIndex ? 'eager' : 'lazy'}
                      decoding="async"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                )}
              </SwiperSlide>
            ))}
          </Swiper>

          {product.images.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon-lg"
                className="absolute left-2 top-1/2 z-10 size-11 -translate-y-1/2 rounded-full bg-black/35 text-white hover:bg-black/65 hover:text-white sm:left-5"
                aria-label="ภาพก่อนหน้า"
                disabled={activeIndex === 0}
                onClick={() => changeSlide(activeIndex - 1)}
              >
                <HugeiconsIcon icon={ArrowLeft02Icon} />
              </Button>
              <Button
                variant="ghost"
                size="icon-lg"
                className="absolute right-2 top-1/2 z-10 size-11 -translate-y-1/2 rounded-full bg-black/35 text-white hover:bg-black/65 hover:text-white sm:right-5"
                aria-label="ภาพถัดไป"
                disabled={activeIndex === product.images.length - 1}
                onClick={() => changeSlide(activeIndex + 1)}
              >
                <HugeiconsIcon icon={ArrowRight02Icon} />
              </Button>
            </>
          )}

          <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pb-2 pt-12 sm:px-6">
            <p className="max-w-prose text-center text-sm text-white" aria-live="polite">
              {currentImage.caption}
            </p>
            {product.images.length > 1 && (
              <ProductGalleryThumbnails
                images={product.images}
                activeIndex={activeIndex}
                onSelect={changeSlide}
                variant="viewer"
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
