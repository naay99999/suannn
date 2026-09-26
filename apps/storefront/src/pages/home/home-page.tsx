import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft02Icon,
  ArrowRight02Icon,
  ArrowUpRight01Icon,
  Leaf01Icon,
  PauseIcon,
  PlayIcon,
} from '@hugeicons/core-free-icons'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Marquee } from '@workspace/ui/components/marquee'
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group'
import { cn } from '@workspace/ui/lib/utils'
import { principles } from './home-data'
import { featuredProducts as products } from '@/lib/catalog'
import { ProductCard } from '@/components/product-card'

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
  const [story, setStory] = useState(0)
  const [paused, setPaused] = useState(false)
  const { hash, key } = useLocation()
  const visibleProducts = products.filter(
    (product) => category === 'all' || product.category === category,
  )

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView()
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
          const cards = gsap.utils.toArray<HTMLElement>('.farm-card', scope.current)
          cards.slice(0, -1).forEach((card, index) => {
            ScrollTrigger.create({
              trigger: card,
              start: `top ${130 + index * 20}px`,
              endTrigger: '.farm-cards',
              end: 'bottom 620px',
              pin: true,
              pinSpacing: false,
            })
            gsap.to(card.querySelector('.farm-card-inner'), {
              scale: 0.96,
              ease: 'none',
              scrollTrigger: {
                trigger: cards[index + 1],
                start: 'top 75%',
                end: 'top 160px',
                scrub: true,
              },
            })
          })
        },
      )
      let active = true
      void document.fonts.ready.then(() => {
        if (active) ScrollTrigger.refresh()
      })
      return () => {
        active = false
        media.revert()
      }
    },
    { scope },
  )

  useEffect(() => {
    ScrollTrigger.refresh()
  }, [category])

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
            className="hero-reveal mx-auto w-full max-w-6xl text-[clamp(2.5rem,5.7vw,5.5rem)] font-semibold leading-[1.32] tracking-tight"
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
            <a
              className={cn(buttonVariants({ size: 'lg' }), 'h-12 rounded-full px-7')}
              href="#products"
            >
              เลือกความอร่อย <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" />
            </a>
            <a
              className={cn(
                buttonVariants({ size: 'lg', variant: 'outline' }),
                'h-12 rounded-full px-7',
              )}
              href="#from-the-farm"
            >
              ทำไมต้อง suannn
            </a>
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

      <div className="marquee-shell relative border-y border-primary/10 bg-accent py-5">
        <Marquee
          pauseOnHover
          repeat={4}
          aria-hidden="true"
          className={cn('suannn-brand-marquee [--duration:35s] [--gap:3rem] !p-0', paused && 'is-paused')}
        >
          {['คัดจากสวน', 'รู้จักคนปลูก', 'โปร่งใสทุกที่มา', 'อร่อยอย่างสบายใจ'].map((text) => (
            <span key={text} className="flex shrink-0 items-center gap-12 text-sm text-secondary-foreground">
              {text}
              <HugeiconsIcon icon={Leaf01Icon} size={20} className="text-primary" />
            </span>
          ))}
        </Marquee>
        <p className="sr-only">คัดจากสวน รู้จักคนปลูก โปร่งใสทุกที่มา อร่อยอย่างสบายใจ</p>
        <Button
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-background/90"
          variant="outline"
          size="icon"
          aria-label={paused ? 'เล่นข้อความเคลื่อนไหว' : 'หยุดข้อความเคลื่อนไหว'}
          onClick={() => setPaused(!paused)}
        >
          <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} />
        </Button>
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
            className="max-w-full flex-wrap rounded-full border bg-muted/50 p-1.5"
          >
            <ToggleGroupItem value="all" className="rounded-full px-4">
              ทั้งหมด
            </ToggleGroupItem>
            <ToggleGroupItem value="fresh" className="rounded-full px-4">
              ผลไม้สด
            </ToggleGroupItem>
            <ToggleGroupItem value="processed" className="rounded-full px-4">
              แปรรูป
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div
          className={cn(
            'mt-10 grid grid-flow-dense gap-x-5 gap-y-10',
            category === 'all' && 'grid-cols-2 lg:grid-cols-4',
            category === 'fresh' && 'grid-cols-1 sm:grid-cols-3',
            category === 'processed' && 'max-w-sm grid-cols-1',
          )}
        >
          {visibleProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
        <p role="status" className="mt-7 text-xs leading-6 text-muted-foreground">
          แสดง {visibleProducts.length} รายการตัวอย่าง · ราคา สถานะ และข้อมูลสวนเป็นตัวอย่าง
          ยังไม่เปิดสั่งซื้อ
        </p>
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
                  className="h-11 rounded-full px-5"
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

      <section
        id="our-story"
        className="page-width scroll-mt-28 py-28 md:py-40"
        aria-labelledby="story-title"
      >
        <div className="grid items-center gap-12 md:grid-cols-[0.85fr_1.15fr] md:gap-20">
          <div className="relative overflow-hidden rounded-[2rem]">
            <img
              src="/images/hero.jpg"
              alt="ดินปลูกและอุปกรณ์ทำสวน ภาพประกอบแนวคิดของแบรนด์"
              width={800}
              height={900}
              loading="lazy"
              className="aspect-[1/1.05] w-full object-cover"
            />
            <span className="glass-label absolute bottom-5 left-5">
              Good things take good care.
            </span>
          </div>
          <div role="region" aria-roledescription="carousel" aria-label="ความตั้งใจของ suannn">
            <p className="mb-6 text-xs tracking-[0.18em] text-muted-foreground">
              THE HEART OF SUANNN
            </p>
            <h2 id="story-title" className="section-heading">
              สวนเล็ก ๆ<br />
              ความตั้งใจที่ไม่เล็ก
            </h2>
            <div className="mt-7 min-h-36" aria-live="polite" aria-atomic="true">
              <p className="text-lg font-medium leading-8">{principles[story].title}</p>
              <p className="mt-4 text-sm leading-8 text-muted-foreground">
                {principles[story].body}
              </p>
            </div>
            <div className="mt-7 flex items-center gap-3">
              <Button
                variant="outline"
                size="icon-lg"
                className="rounded-full"
                aria-label="แนวคิดก่อนหน้า"
                onClick={() => setStory((story + principles.length - 1) % principles.length)}
              >
                <HugeiconsIcon icon={ArrowLeft02Icon} />
              </Button>
              <Button
                variant="outline"
                size="icon-lg"
                className="rounded-full"
                aria-label="แนวคิดถัดไป"
                onClick={() => setStory((story + 1) % principles.length)}
              >
                <HugeiconsIcon icon={ArrowRight02Icon} />
              </Button>
              <span className="ml-3 text-xs text-muted-foreground">
                {String(story + 1).padStart(2, '0')} / 03
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="page-width pb-12" aria-labelledby="cta-title">
        <div className="suannn-cta relative isolate overflow-hidden rounded-[2rem] px-6 py-20 text-center md:py-28">
          <HugeiconsIcon icon={Leaf01Icon} size={40} className="mx-auto mb-7 text-primary" />
          <h2 id="cta-title" className="section-heading">
            ให้ทุกวัน มีเรื่องดี ๆ จากสวน
          </h2>
          <p className="mt-5 text-sm leading-7 text-muted-foreground">
            เริ่มจากผลไม้ที่ชอบ แล้วค้นพบความตั้งใจของคนปลูก
          </p>
          <a
            href="#products"
            className={cn(buttonVariants({ size: 'lg' }), 'mt-8 h-12 rounded-full px-8')}
          >
            ไปเดินสวนกัน <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" />
          </a>
          <span className="cta-wordmark" aria-hidden="true">
            suannn.
          </span>
        </div>
      </section>
    </div>
  )
}
