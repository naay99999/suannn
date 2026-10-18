import { Skeleton } from '@workspace/ui/components/skeleton'
import { SkeletonRegion } from '@/components/loading/skeleton-region'

/** Mirrors the breadcrumb and hero of the farm profile page. */
export function FarmDetailSkeleton() {
  return (
    <SkeletonRegion label="กำลังโหลดข้อมูลสวน..." className="page-width">
      <div aria-hidden="true">
        <Skeleton className="h-4 w-64 max-w-full" />
        <div className="grid items-center gap-8 py-8 md:grid-cols-[0.9fr_1.1fr] md:gap-14 md:py-14">
          <Skeleton className="aspect-[5/4] w-full rounded-4xl md:order-2" />
          <div className="flex flex-col md:order-1">
            <Skeleton className="mb-4 h-4 w-40" />
            <Skeleton className="h-14 w-4/5" />
            <Skeleton className="mt-5 h-6 w-1/2" />
            <Skeleton className="mt-6 h-4 w-full max-w-2xl" />
            <Skeleton className="mt-3 h-4 w-5/6 max-w-2xl" />
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}
