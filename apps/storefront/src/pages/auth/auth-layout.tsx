import { useId, useRef, type ReactNode } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

gsap.registerPlugin(useGSAP)

export function AuthPageFrame({ title, description, children }: {
  title: string
  description: string
  children: ReactNode
}) {
  const scope = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useGSAP(() => {
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('.auth-photo', { scale: 1.025, duration: 0.65, ease: 'power2.out' })
      gsap.from('.auth-form', { y: 8, duration: 0.3, ease: 'power2.out' })
    })
    return () => media.revert()
  }, { scope })

  return (
    <div ref={scope} className="grid w-full min-w-0 flex-1 grid-cols-1 grid-rows-[auto_1fr] overflow-hidden bg-background lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:grid-rows-none">
      <div className="relative h-24 overflow-hidden bg-accent lg:h-auto">
        <img
          src="/images/fruit-hero.jpg"
          alt="ผลไม้สดที่คัดจากสวน"
          width={1200}
          height={800}
          className="auth-photo absolute inset-0 size-full object-cover"
        />
      </div>
      <div className="auth-form flex min-w-0 items-start justify-center px-6 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-12 sm:py-12 lg:items-center lg:py-16">
        <section aria-labelledby={titleId} className="mx-auto w-full max-w-md">
          <h1 id={titleId} className="w-full max-w-md text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
          <div className="mt-8">{children}</div>
        </section>
      </div>
    </div>
  )
}
