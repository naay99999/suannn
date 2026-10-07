import { Link } from 'react-router'
import { FarmImage } from './farm-image'
import type { StoreProductDetail } from '@/lib/store-products'

export function ProductFarms({ farms }: { farms: StoreProductDetail['farms'] }) {
  if (!farms.length) return null
  return (
    <section className="mt-10 border-t pt-8" aria-labelledby="product-farms-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="product-farms-title" className="text-xl font-semibold">แหล่งผลิตของสินค้านี้</h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">ข้อมูลระดับสินค้า สินค้าเดียวกันอาจมาจากหลายสวน และยังไม่ระบุสวนของล็อตที่จัดส่ง</p>
        </div>
        <Link to="/farms" className="text-sm font-medium text-primary-ink underline-offset-4 hover:underline">รู้จักสวนทั้งหมด</Link>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {farms.map(farm => <Link key={farm.id} to={`/farms/${farm.slug}`} className="group flex min-w-0 items-center gap-4 rounded-2xl border p-3 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <FarmImage src={farm.coverImageUrl} alt={farm.coverImageAlt} demo={farm.isDemo} className="size-20 shrink-0 rounded-xl sm:size-24" />
          <div className="min-w-0">
            <p className="line-clamp-2 font-semibold leading-relaxed group-hover:text-primary">{farm.name}</p>
            {farm.farmerName && <p className="mt-1 text-sm text-muted-foreground">{farm.farmerName}</p>}
            {[farm.district, farm.province].filter(Boolean).length > 0 && <p className="mt-1 text-xs text-muted-foreground">{[farm.district, farm.province].filter(Boolean).join(' · ')}</p>}
          </div>
        </Link>)}
      </div>
    </section>
  )
}
