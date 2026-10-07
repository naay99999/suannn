import { useState } from 'react'
import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft02Icon, ArrowRight02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@workspace/ui/components/button'
import { FarmImage } from '@/components/farms/farm-image'
import type { StoreFarmSummary } from '@/lib/store-farms'

export function FarmGrowerCarousel({ farms }: { farms: StoreFarmSummary[] }) {
  const [activeIndex, setActiveIndex] = useState(0)
  if (!farms.length) return null
  const active = farms[activeIndex]!
  const location = [active.district, active.province].filter(Boolean).join(' · ')
  const move = (direction: number) => setActiveIndex(index => (index + direction + farms.length) % farms.length)

  return (
    <div className="grid items-center gap-6 md:grid-cols-[1fr_1fr] md:gap-12" role="region" aria-roledescription="carousel" aria-label="สวนและเกษตรกร">
      <Link to={`/farms/${active.slug}`} className="group block rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
        <FarmImage src={active.coverImageUrl} alt={active.coverImageAlt} demo={active.isDemo} className="aspect-[5/4] rounded-3xl" />
      </Link>
      <div aria-live="polite" aria-atomic="true">
        <p className="text-sm font-medium text-primary-ink">สวนและคนปลูก</p>
        <h3 className="mt-3 text-3xl font-semibold leading-relaxed tracking-tight md:text-4xl"><Link to={`/farms/${active.slug}`} className="underline-offset-4 hover:underline focus-visible:outline-ring">{active.name}</Link></h3>
        {active.farmerName && <p className="mt-3 text-base text-muted-foreground">ดูแลโดย {active.farmerName}</p>}
        {location && <p className="mt-2 text-sm text-muted-foreground">{location}</p>}
        {active.summary && <p className="mt-5 max-w-xl text-sm leading-8 text-muted-foreground">{active.summary}</p>}
        <div className="mt-7 flex items-center gap-3">
          <Button variant="outline" size="icon-lg" className="rounded-full" aria-label="สวนก่อนหน้า" onClick={() => move(-1)}><HugeiconsIcon icon={ArrowLeft02Icon} /></Button>
          <Button variant="outline" size="icon-lg" className="rounded-full" aria-label="สวนถัดไป" onClick={() => move(1)}><HugeiconsIcon icon={ArrowRight02Icon} /></Button>
          <span className="ml-2 text-sm text-muted-foreground">{activeIndex + 1} / {farms.length}</span>
          <Link to={`/farms/${active.slug}`} className="ml-auto text-sm font-medium text-primary-ink underline-offset-4 hover:underline">อ่านเรื่องราวของสวน</Link>
        </div>
      </div>
    </div>
  )
}
