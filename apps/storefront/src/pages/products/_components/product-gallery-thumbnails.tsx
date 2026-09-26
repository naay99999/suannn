import type { ProductImage } from '@/lib/catalog'

interface ProductGalleryThumbnailsProps {
  images: readonly ProductImage[]
  activeIndex: number
  onSelect: (index: number) => void
  variant?: 'inline' | 'viewer'
}

export function ProductGalleryThumbnails({
  images,
  activeIndex,
  onSelect,
  variant = 'inline',
}: ProductGalleryThumbnailsProps) {
  const isViewer = variant === 'viewer'

  return (
    <div
      role="group"
      aria-label="เลือกภาพสินค้า"
      className={`flex w-full gap-2 overflow-x-auto overscroll-x-contain py-1 ${isViewer ? 'justify-center pb-[max(env(safe-area-inset-bottom),1rem)]' : ''}`}
    >
      {images.map((image, index) => {
        const selected = activeIndex === index
        return (
          <button
            key={image.src}
            type="button"
            aria-label={`แสดงภาพที่ ${index + 1}: ${image.alt}`}
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelect(index)}
            className={`flex min-h-16 shrink-0 flex-col items-center gap-1 rounded-xl p-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              isViewer ? 'text-white' : 'text-muted-foreground'
            }`}
          >
            <span className={`size-14 overflow-hidden rounded-lg border-2 sm:size-16 ${
              selected
                ? isViewer ? 'border-white' : 'border-primary'
                : isViewer ? 'border-white/30' : 'border-transparent'
            }`}>
              <img
                src={image.thumbnailSrc ?? image.src}
                alt=""
                width={64}
                height={64}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
            </span>
            <span className="text-[10px] leading-4">{index + 1}</span>
          </button>
        )
      })}
    </div>
  )
}
