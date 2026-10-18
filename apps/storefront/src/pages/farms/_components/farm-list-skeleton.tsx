import { Skeleton } from '@workspace/ui/components/skeleton'
import { SkeletonRegion } from '@/components/loading/skeleton-region'

/** Mirrors `FarmCard` in the farm list grid. */
export function FarmListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SkeletonRegion label="กำลังโหลดรายชื่อสวน..." className="grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} aria-hidden="true" className="min-w-0">
          <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
          <Skeleton className="mt-5 h-7 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/2" />
          <Skeleton className="mt-3 h-4 w-5/6" />
        </div>
      ))}
    </SkeletonRegion>
  )
}
