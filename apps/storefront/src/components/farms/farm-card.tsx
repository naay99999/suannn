import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import { FarmImage } from './farm-image'
import type { StoreFarmSummary } from '@/lib/store-farms'

export function FarmCard({ farm }: { farm: StoreFarmSummary }) {
  const location = [farm.district, farm.province].filter(Boolean).join(' · ')
  return (
    <article className="group min-w-0">
      <Link to={`/farms/${farm.slug}`} className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
        <FarmImage src={farm.coverImageUrl} alt={farm.coverImageAlt} demo={farm.isDemo} className="aspect-[4/3] rounded-2xl" />
        <div className="mt-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-relaxed tracking-tight group-hover:text-primary">{farm.name}</h2>
            {farm.farmerName && <p className="mt-1 text-sm text-muted-foreground">ดูแลโดย {farm.farmerName}</p>}
            {location && <p className="mt-2 text-sm text-muted-foreground">{location}</p>}
            {farm.summary && <p className="mt-3 line-clamp-3 text-sm leading-7 text-muted-foreground">{farm.summary}</p>}
          </div>
          <span className="mt-1 grid size-10 shrink-0 place-items-center rounded-full border transition-colors group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={18} aria-hidden="true" />
          </span>
        </div>
      </Link>
    </article>
  )
}
