import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowUpRight01Icon,
  Leaf01Icon,
} from '@hugeicons/core-free-icons'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Marquee } from '@workspace/ui/components/marquee'
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group'
import { cn } from '@workspace/ui/lib/utils'
import { principles } from './home-data'
import { getStoreProducts, storeProductQueryKey } from '@/lib/store-products'
import { ProductRecommendations, recommendationLimit } from '@/components/product-recommendations'
import { FeaturedFarms } from '@/components/farms/featured-farms'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const collections = [
  {
    title: 'สดจากฤดูกาล',
    subtitle: 'FRESH FROM THE FARM',
    description: 'ผลไม้ที่ทำให้ทุกวันมีรสชาติ',
    image: '/images/orange.jpg',
    category: 'fresh',
  },
  {
    title: 'เก็บความอร่อยไว้',
    subtitle: 'A LITTLE LONGER',
    description: 'ผลผลิตแปรรูปที่ต่อยอดความตั้งใจ',
    image: '/images/mango.jpg',
    category: 'processed',
  },
  {
    title: 'รู้ที่มา อร่อยกว่า',
    subtitle: 'KNOW YOUR ROOTS',
    description: 'ทำความรู้จักเส้นทางจากสวนถึงคุณ',
    image: '/images/hero.jpg',
    category: 'story',
  },
]

export function Component() {
  const scope = useRef<HTMLDivElement>(null)
  const [category, setCategory] = useState('all')
  const [activeCollection, setActiveCollection] = useState(0)
  const { hash, key } = useLocation()
  const featured = useQuery({
    queryKey: storeProductQueryKey({ category: category === 'all' ? undefined : category as 'fresh' | 'processed', limit: recommendationLimit }),
    queryFn: () => getStoreProducts({ category: category === 'all' ? undefined : category as 'fresh' | 'processed', limit: recommendationLimit }),
  })
  const visibleProducts = featured.data?.items ?? []

  useEffect(() => {
    if (!hash) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [hash, key])

  useGSAP(
    () => {
      const media = gsap.matchMedia()
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('.hero-reveal', {
          y: 24,
          opacity: 0,
          duration: 0.85,
          stagger: 0.1,
          ease: 'power3.out',
        })
      })
      // Each card pins `step` px below the previous one and shrinks as the next
      // card slides over it, so the stack reads like a deck being dealt.
      function stackCards(top: number, step: number, end: (cards: HTMLElement[]) => ScrollTrigger.Vars) {
        const cards = gsap.utils.toArray<HTMLElement>('.farm-card', scope.current)
        cards.slice(0, -1).forEach((card, index) => {
          ScrollTrigger.create({
            trigger: card,
            start: `top ${top + index * step}px`,
            ...end(cards),
            pin: true,
            pinSpacing: false,
          })
          gsap.to(card.querySelector('.farm-card-inner'), {
            scale: 0.96,
            ease: 'none',
            scrollTrigger: {
              trigger: cards[index + 1],
              start: 'top 75%',
              end: `top ${top + (index + 1) * step + 10}px`,
              scrub: true,
            },
          })
        })
      }
      media.add(
        '(min-width: 1024px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)',
        () => {
          ScrollTrigger.create({
            trigger: '.farm-intro',
            start: 'top 130px',
            endTrigger: '.farm-cards',
            end: 'bottom 620px',
            pin: true,
            pinSpacing: false,
          })
          stackCards(130, 20, () => ({ endTrigger: '.farm-cards', end: 'bottom 620px' }))
        },
      )
      // On narrow screens the intro sits above the cards, so only the cards stack,
      // just below the 88px sticky header. Pins release once the last card lands.
      media.add('(max-width: 1023px) and (prefers-reduced-motion: no-preference)', () => {
        stackCards(104, 16, (cards) => ({
          endTrigger: cards.at(-1),
          end: `top ${104 + (cards.length - 1) * 16}px`,
        }))
      })
      // Async content (products, farms, fonts) changes the page height after the
      // pins are measured, so re-measure whenever the layout height changes.
      let frame = 0
      let height = scope.current?.offsetHeight ?? 0
      const observer = new ResizeObserver(() => {
        const next = scope.current?.offsetHeight ?? 0
        if (next === height) return
        height = next
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => ScrollTrigger.refresh())
      })
      if (scope.current) observer.observe(scope.current)
      return () => {
        observer.disconnect()
        cancelAnimationFrame(frame)
        media.revert()
      }
    },
    { scope },
  )

  function chooseCollection(value: string) {
    if (value === 'story')
      document.getElementById('from-the-farm')?.scrollIntoView({ behavior: 'instant' })
    else {
      setCategory(value)
      document.getElementById('products')?.scrollIntoView({ behavior: 'instant' })
    }
  }

  return (
    <div ref={scope}>
      <title>suannn — ความสดจากสวน ความสุขถึงคุณ</title>
      <section className="suannn-hero relative isolate text-center" aria-labelledby="hero-title">
        <div className="hero-orb hero-orb-left" aria-hidden="true" />
        <div className="hero-orb hero-orb-right" aria-hidden="true" />
        <div className="relative z-10 mx-auto px-5 pt-14 md:pt-20">
          <p className="hero-reveal mb-6 text-xs font-medium tracking-[0.22em] text-muted-foreground">
            GOOD FOOD. GOOD ROOTS.
          </p>
          <h1
            id="hero-title"
            className="hero-reveal mx-auto w-full max-w-6xl text-display font-semibold tracking-tight"
          >
            ความสดจากสวน
            <br />
            <span className="text-primary">ความสุขถึงคุณ</span>
          </h1>
          <p className="hero-reveal mx-auto mt-5 max-w-lg text-sm leading-7 text-muted-foreground md:text-base">
            ผลไม้และของอร่อยจากเกษตรกรที่เราคัดสรร
            <br className="hidden sm:block" /> รู้ว่าใครปลูก รู้ว่ามาจากไหน เลือกได้ด้วยความสบายใจ
          </p>
          <div className="hero-reveal mt-7 flex flex-wrap justify-center gap-3">
            <Link
              className={buttonVariants({ size: 'storefront' })}
              to="#products"
            >
              เลือกความอร่อย <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" />
            </Link>
            <Link
              className={buttonVariants({ size: 'storefront', variant: 'outline' })}
              to="#from-the-farm"
            >
              ทำไมต้อง suannn
            </Link>
          </div>
        </div>
        <div className="hero-still-life hero-reveal relative w-full">
          <img
            src="/images/fruit-hero.jpg"
            alt="ผลไม้หลากสีในถุงผ้าและลังสีเขียว ภาพประกอบความสดจากสวน"
            width={1536}
            height={1024}
            fetchPriority="high"
            className="size-full object-cover"
          />
          <div className="hero-glass-note">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <HugeiconsIcon icon={Leaf01Icon} size={21} />
            </span>
            <div className="text-left">
              <p className="text-sm font-semibold">คัดด้วยใจ ส่งต่อจากสวน</p>
              <p className="mt-1 text-xs text-muted-foreground">From good roots, with love.</p>
            </div>
          </div>
          <span className="hero-side-note hidden md:block">A FRESHER WAY TO EVERYDAY.</span>
        </div>
      </section>

      <div className="border-y border-primary/10 bg-accent py-5">
        <Marquee
          repeat={4}
          aria-hidden="true"
          className="suannn-brand-marquee [--duration:35s] [--gap:3rem] !p-0"
        >
          {['คัดจากสวน', 'รู้จักคนปลูก', 'โปร่งใสทุกที่มา', 'อร่อยอย่างสบายใจ'].map((text) => (
            <span key={text} className="flex shrink-0 items-center gap-12 text-sm text-secondary-foreground">
              {text}
              <HugeiconsIcon icon={Leaf01Icon} size={20} className="text-primary" />
            </span>
          ))}
        </Marquee>
        <p className="sr-only">คัดจากสวน รู้จักคนปลูก โปร่งใสทุกที่มา อร่อยอย่างสบายใจ</p>
      </div>

      <section
        id="products"
        className="page-width scroll-mt-28 py-24 md:py-36"
        aria-labelledby="products-title"
      >
        <div className="flex flex-col justify-between gap-7 md:flex-row md:items-end">
          <div>
            <p className="mb-3 text-xs tracking-[0.18em] text-muted-foreground">
              A TASTE OF SUANNN
            </p>
            <h2 id="products-title" className="section-heading">
              ของดี ที่อยากให้ลอง<span className="text-primary">.</span>
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              เลือกความสดที่ชอบ เลือกความอร่อยที่ใช่
            </p>
          </div>
          <ToggleGroup
            aria-label="ประเภทสินค้า"
            value={[category]}
            onValueChange={(value) => {
              if (value.length) setCategory(value[0] as string)
            }}
            className="max-w-full flex-wrap border bg-muted/50 p-1.5"
          >
            <ToggleGroupItem value="all" className="px-4">
              ทั้งหมด
            </ToggleGroupItem>
            <ToggleGroupItem value="fresh" className="px-4">
              ผลไม้สด
            </ToggleGroupItem>
            <ToggleGroupItem value="processed" className="px-4">
              แปรรูป
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {featured.isPending ? <p role="status" className="mt-8 text-muted-foreground">กำลังโหลดสินค้า...</p> : null}
        {featured.isError ? <div role="alert" className="mt-8 flex flex-wrap items-center gap-3"><p>โหลดสินค้าแนะนำไม่ได้</p><Button variant="outline" onClick={() => void featured.refetch()}>ลองอีกครั้ง</Button></div> : null}
        {featured.data && visibleProducts.length === 0 ? (
          <Empty className="mt-8 border py-12">
            <EmptyHeader><EmptyTitle>ยังไม่มีสินค้าในหมวดนี้</EmptyTitle><EmptyDescription>กลับมาดูอีกครั้งเมื่อมีสินค้าเผยแพร่</EmptyDescription></EmptyHeader>
            <EmptyContent><Button variant="outline" onClick={() => setCategory('all')}>ดูสินค้าทั้งหมด</Button></EmptyContent>
          </Empty>
        ) : null}
        {visibleProducts.length > 0 ? <div className="mt-10">
          <ProductRecommendations key={category} products={visibleProducts} label="สินค้าแนะนำ" />
        </div> : null}
      </section>

      <section
        id="collections"
        className="page-width scroll-mt-28 pb-28 md:pb-40"
        aria-labelledby="collections-title"
      >
        <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <h2 id="collections-title" className="section-heading">
            วันนี้ อยากอร่อยแบบไหน
          </h2>
          <p className="text-sm text-muted-foreground">A little something for every day.</p>
        </div>
        <div className="collection-accordion">
          {collections.map((collection, index) => (
            <article
              key={collection.title}
              className={cn('collection-panel group', activeCollection === index && 'is-active')}
              onMouseEnter={() => setActiveCollection(index)}
            >
              <img
                src={collection.image}
                alt=""
                width={800}
                height={1000}
                loading="lazy"
                className="absolute inset-0 size-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="collection-shade absolute inset-0" />
              <button
                className="collection-heading"
                aria-expanded={activeCollection === index}
                aria-controls={`collection-${index}`}
                onClick={() => setActiveCollection(index)}
                onFocus={() => setActiveCollection(index)}
              >
                <span className="text-xs tracking-[0.15em]">{collection.subtitle}</span>
                <span className="mt-3 block text-2xl font-medium">{collection.title}</span>
              </button>
              <div
                id={`collection-${index}`}
                className="collection-detail"
                hidden={activeCollection !== index}
              >
                <p className="mb-5 text-sm">{collection.description}</p>
                <Button
                  variant="secondary"
                  className="px-5"
                  onClick={() => chooseCollection(collection.category)}
                >
                  เข้าไปดู <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        id="from-the-farm"
        className="farm-section scroll-mt-28 py-28 md:py-40"
        aria-labelledby="farm-title"
      >
        <div className="page-width grid gap-14 lg:grid-cols-2 lg:gap-24">
          <div className="farm-intro self-start">
            <p className="mb-5 text-xs tracking-[0.2em] text-primary-ink">CLOSER TO THE ROOTS</p>
            <h2 id="farm-title" className="section-heading leading-[1.45]">
              มากกว่าของอร่อย
              <br />
              คือการรู้ว่า<span className="text-primary">มาจากไหน</span>
            </h2>
            <p className="mt-6 max-w-md text-sm leading-8 text-muted-foreground">
              เราเชื่อว่าความสบายใจ เริ่มต้นจากความโปร่งใส
              <br />
              suannn จึงอยากเชื่อมคุณกับคนปลูก ผ่านผลผลิต
              <br className="hidden xl:block" />
              ที่คัดเลือกด้วยความเข้าใจและความตั้งใจ
            </p>
            <div className="mt-9 flex items-center gap-3 text-sm font-medium">
              <span className="size-2 rounded-full bg-primary" />
              จากคนปลูก ผ่านสวน ถึงคุณ
            </div>
          </div>
        <div className="farm-cards flex flex-col gap-6">
            {principles.map((principle) => (
              <article key={principle.number} className="farm-card">
                <div className="farm-card-inner">
                  <span
                    className="font-sans text-6xl font-medium tracking-tight text-primary/25"
                    aria-hidden="true"
                  >
                    {principle.number}
                  </span>
                  <h3 className="mt-9 text-xl font-semibold leading-relaxed">{principle.title}</h3>
                  <p className="mt-4 text-sm leading-8 text-muted-foreground">{principle.body}</p>
                  <p className="mt-9 border-t pt-5 text-xs text-primary-ink">{principle.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <FeaturedFarms />

      <section className="page-width pb-12" aria-labelledby="cta-title">
        <div className="suannn-cta relative isolate overflow-hidden rounded-4xl px-6 py-20 text-center md:py-28">
          <HugeiconsIcon icon={Leaf01Icon} size={40} className="mx-auto mb-7 text-primary" />
          <h2 id="cta-title" className="section-heading">
            ให้ทุกวัน มีเรื่องดี ๆ จากสวน
          </h2>
          <p className="mt-5 text-sm leading-7 text-muted-foreground">
            เริ่มจากผลไม้ที่ชอบ แล้วค้นพบความตั้งใจของคนปลูก
          </p>
          <Link
            to="#products"
            className={cn(buttonVariants({ size: 'storefront' }), 'mt-8 px-8')}
          >
            ไปเดินสวนกัน <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" />
          </Link>
          <span className="cta-wordmark" aria-hidden="true">
            suannn.
          </span>
        </div>
      </section>
    </div>
  )
}
