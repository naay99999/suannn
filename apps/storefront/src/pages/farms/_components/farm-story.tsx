import type { StoreFarmDetail } from '@/lib/store-farms'

function FarmRevealText({ text }: { text: string }) {
  return <>{text.split(/(\s+)/).map((part, index) => /\s+/.test(part)
    ? part
    : <span key={`${index}-${part}`} className="farm-reveal-word inline-block">{part}</span>)}</>
}

export function FarmStory({ farm }: { farm: StoreFarmDetail }) {
  if (!farm.story && !farm.growingPractices) return null
  return (
    <div className="grid gap-12 border-t py-12 md:grid-cols-2 md:gap-16 md:py-16">
      {farm.story && <section aria-labelledby="farm-story-title">
        <h2 id="farm-story-title" className="text-2xl font-semibold tracking-tight">เรื่องราวของสวน</h2>
        <p className="farm-reveal mt-5 whitespace-pre-line text-base leading-8 text-muted-foreground"><FarmRevealText text={farm.story} /></p>
      </section>}
      {farm.growingPractices && <section aria-labelledby="farm-practices-title">
        <h2 id="farm-practices-title" className="text-2xl font-semibold tracking-tight">วิธีดูแลผลผลิต</h2>
        <p className="farm-reveal mt-5 whitespace-pre-line text-base leading-8 text-muted-foreground"><FarmRevealText text={farm.growingPractices} /></p>
      </section>}
    </div>
  )
}
