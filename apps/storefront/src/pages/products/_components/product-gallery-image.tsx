import type { ImgHTMLAttributes } from 'react'

interface ProductGalleryImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'src'> {
  src: string | null
  alt: string
  failed: boolean
  onImageError: (src: string) => void
  thumbnail?: boolean
}

export function ProductGalleryImage({
  src,
  alt,
  failed,
  onImageError,
  thumbnail = false,
  className,
  ...props
}: ProductGalleryImageProps) {
  if (failed || !src) {
    return (
      <span
        role={thumbnail ? undefined : 'img'}
        aria-label={thumbnail ? undefined : alt}
        aria-hidden={thumbnail || undefined}
        className={`flex size-full items-center justify-center bg-muted px-4 text-center text-sm text-muted-foreground ${className ?? ''}`}
      >
        ภาพสินค้าไม่พร้อมใช้งาน
      </span>
    )
  }

  return (
    <img
      {...props}
      src={src}
      alt={thumbnail ? '' : alt}
      className={className}
      onError={() => onImageError(src)}
    />
  )
}
