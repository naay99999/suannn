import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Leaf01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@workspace/ui/lib/utils'

interface FarmImageProps {
  src: string | null
  alt: string | null
  className?: string
  loading?: 'eager' | 'lazy'
  width?: number | null
  height?: number | null
}

export function FarmImage({ src, alt, className, loading = 'lazy', width, height }: FarmImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const hasImage = Boolean(src && failedSrc !== src)

  return (
    <div className={cn('relative overflow-hidden bg-accent', className)}>
      {hasImage ? (
        <img
          src={src!}
          alt={alt ?? ''}
          width={width ?? undefined}
          height={height ?? undefined}
          loading={loading}
          className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 motion-reduce:transition-none"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div role="img" aria-label={alt || 'ภาพประกอบสวน'} className="grid size-full place-items-center bg-gradient-to-br from-primary/10 via-accent to-secondary/20 text-primary">
          <HugeiconsIcon icon={Leaf01Icon} size={42} aria-hidden="true" />
        </div>
      )}
    </div>
  )
}
