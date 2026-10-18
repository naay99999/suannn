import { Skeleton } from '@workspace/ui/components/skeleton'
import { cn } from '@workspace/ui/lib/utils'
import { SkeletonRegion } from './skeleton-region'

const defaultGridClassName = 'grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4'

/**
 * Placeholder grid that mirrors `ProductCard`, so the layout does not jump when products arrive.
 * `className` replaces the default grid so callers can pass the exact layout of the real list.
 */
export function ProductGridSkeleton({
  className = defaultGridClassName,
  itemClassName,
  count = 8,
  appearance = 'default',
  label = 'กำลังโหลดสินค้า',
}: {
  className?: string
  itemClassName?: string
  count?: number
  appearance?: 'default' | 'catalog'
  label?: string
}) {
  const catalog = appearance === 'catalog'
  return (
    <SkeletonRegion label={label} className={className}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} aria-hidden="true" className={cn('flex min-w-0 flex-col gap-3', catalog && 'rounded-2xl border p-2.5 sm:p-3', itemClassName)}>
          <Skeleton className={catalog ? 'aspect-square w-full rounded-xl' : 'aspect-[1/1.08] w-full rounded-3xl'} />
          <div className={cn('flex flex-col gap-2', catalog ? 'pt-1' : 'px-1 pt-2')}>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
          {catalog && <Skeleton className="h-(--field-h) w-full rounded-field" />}
        </div>
      ))}
    </SkeletonRegion>
  )
}
