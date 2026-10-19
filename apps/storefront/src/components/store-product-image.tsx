import { useState } from 'react'

interface StoreProductImageProps {
  src: string | null
  alt: string
  className?: string
  loading?: 'eager' | 'lazy'
  fetchPriority?: 'high' | 'low' | 'auto'
  width?: number | null
  height?: number | null
}

export function StoreProductImage({ src, alt, className, loading = 'lazy', fetchPriority, width, height }: StoreProductImageProps) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div role="img" aria-label={alt || 'ภาพสินค้าไม่พร้อมใช้งาน'} className={`grid place-items-center bg-muted px-4 text-center text-sm text-muted-foreground ${className ?? ''}`}>
        ไม่มีรูปสินค้า
      </div>
    )
  }

  return <img src={src} alt={alt} width={width ?? undefined} height={height ?? undefined} loading={loading} fetchPriority={fetchPriority} onError={() => setFailed(true)} className={className} />
}
