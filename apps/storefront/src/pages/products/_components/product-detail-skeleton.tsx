import { Skeleton } from '@workspace/ui/components/skeleton'
import { SkeletonRegion } from '@/components/loading/skeleton-region'

/** Mirrors the breadcrumb, gallery and purchase column of the product detail page. */
export function ProductDetailSkeleton() {
  return (
    <SkeletonRegion label="กำลังโหลดสินค้า...">
      <div aria-hidden="true">
        <Skeleton className="h-4 w-56 max-w-full" />
        <div className="mt-8 grid items-start gap-9 lg:grid-cols-2 lg:gap-16">
          <Skeleton className="aspect-square w-full rounded-3xl md:aspect-[1.08/1] md:rounded-4xl" />
          <div className="flex flex-col py-2 lg:py-5">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="mt-6 h-10 w-3/4" />
            <Skeleton className="my-7 h-10 w-40" />
            <Skeleton className="mb-6 h-4 w-48" />
            <Skeleton className="h-12 w-full rounded-pill" />
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}
