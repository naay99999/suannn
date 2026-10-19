import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useLocation } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
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
import { getStoreProducts, storeProductQueryKey, type StoreProductSummary } from '@/lib/store-products'
import { ProductRecommendations, ProductRecommendationsSkeleton, recommendationLimit } from '@/components/product-recommendations'
import { FeaturedFarms } from '@/components/farms/featured-farms'

type ProductCategory = 'all' | 'fresh' | 'processed'

const heroSrcSet = (format: 'avif' | 'webp') =>
  [640, 1024, 1536].map(width => `/images/hero/fruit-hero-${width}.${format} ${width}w`).join(', ')

const collections = [
  {
    title: 'สดจากฤดูกาล',
    subtitle: 'FRESH FROM THE FARM',
    description: 'ผลไม้ที่ทำให้ทุกวันมีรสชาติ',
    image: { name: 'orange', fallback: '/images/orange.jpg', width: 800, height: 1200 },
    to: '/categories/fresh',
  },
  {
    title: 'เก็บความอร่อยไว้',
    subtitle: 'A LITTLE LONGER',
    description: 'ผลผลิตแปรรูปที่ต่อยอดความตั้งใจ',
    image: { name: 'mango', fallback: '/images/mango.jpg', width: 800, height: 600 },
    to: '/categories/processed',
  },
  {
    title: 'รู้ที่มา อร่อยกว่า',
    subtitle: 'KNOW YOUR ROOTS',
    description: 'ทำความรู้จักเส้นทางจากสวนถึงคุณ',
    image: { name: 'story', fallback: '/images/collections/story.jpg', width: 800, height: 533 },
    to: '#from-the-farm',
  },
]

const catalogLinks: Record<ProductCategory, { to: string; label: string }> = {
  all: { to: '/products', label: 'ดูสินค้าทั้งหมด' },
  fresh: { to: '/categories/fresh', label: 'ดูผลไม้สดทั้งหมด' },
  processed: { to: '/categories/processed', label: 'ดูผลิตภัณฑ์แปรรูปทั้งหมด' },
}

// Each farm card pins below the previous one; the card underneath shrinks along the next card's view timeline.
const farmTimelines = principles.map((_, index) => `--farm-card-${index}`)

function productListJsonLd(products: StoreProductSummary[]) {
  const origin = window.location.origin
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'สินค้าแนะนำจาก suannn',
    itemListElement: products.map((product, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Product',
        name: product.name,
        url: `${origin}/products/${product.slug}`,
        image: product.coverImage?.url,
        offers: {
          '@type': 'Offer',
          priceCurrency: 'THB',
          price: (product.minPriceSatang / 100).toFixed(2),
          availability: product.canPurchase ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        },
      },
    })),
  }).replaceAll('<', '\\u003c')
}

const categoryItemClassName = 'px-4 text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:shadow-sm aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground'

export function Component() {
  const [category, setCategory] = useState<ProductCategory>('all')
  const [activeCollection, setActiveCollection] = useState(0)
  const { hash, key } = useLocation()
  const productQuery = { category: category === 'all' ? undefined : category, limit: recommendationLimit }
  const featured = useQuery({
    queryKey: storeProductQueryKey(productQuery),
    queryFn: () => getStoreProducts(productQuery),
    placeholderData: keepPreviousData,
  })
  const visibleProducts = featured.data?.items ?? []
  const catalogLink = catalogLinks[category]

  // Wait for the products above the target to lay out, then scroll and move focus to the section heading.
  useEffect(() => {
    if (!hash || featured.isPending) return
    const section = document.getElementById(hash.slice(1))
    if (!section) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
    section.querySelector<HTMLElement>('h2[tabindex="-1"]')?.focus({ preventScroll: true })
  }, [hash, key, featured.isPending])

  return (
    <div>
      <title>suannn — ความสดจากสวน ความสุขถึงคุณ</title>
      <section className="suannn-hero relative isolate text-center" aria-labelledby="hero-title">
        <div className="relative z-10 mx-auto px-5 pt-14 md:pt-20">
          <p lang="en" className="hero-reveal mb-6 text-xs font-medium tracking-[0.22em] text-muted-foreground">
            GOOD FOOD. GOOD ROOTS.
          </p>
          <h1
            id="hero-title"
            className="hero-reveal mx-auto w-full max-w-6xl text-display font-semibold tracking-tight [--i:1]"
          >
            ความสดจากสวน
            <br />
            <span className="text-primary">ความสุขถึงคุณ</span>
          </h1>
          <p className="hero-reveal mx-auto mt-5 max-w-lg text-sm leading-7 text-muted-foreground md:text-base [--i:2]">
            ผลไม้และของอร่อยจากเกษตรกรที่เราคัดสรร
            <br className="hidden sm:block" /> รู้ว่าใครปลูก รู้ว่ามาจากไหน เลือกได้ด้วยความสบายใจ
          </p>
          <div className="hero-reveal mt-7 flex flex-wrap justify-center gap-3 [--i:3]">
            <Link
              className={buttonVariants({ size: 'storefront' })}
              to="#products"
            >
              เลือกความอร่อย <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" aria-hidden="true" />
            </Link>
            <Link
              className={buttonVariants({ size: 'storefront', variant: 'outline' })}
              to="#from-the-farm"
            >
              ทำไมต้อง suannn
            </Link>
          </div>
        </div>
        <div className="hero-still-life relative w-full">
          <picture className="contents">
            <source type="image/avif" srcSet={heroSrcSet('avif')} sizes="100vw" />
            <source type="image/webp" srcSet={heroSrcSet('webp')} sizes="100vw" />
            <img
              src="/images/fruit-hero.jpg"
              alt="ผลไม้หลากสีในถุงผ้าและลังสีเขียว ภาพประกอบความสดจากสวน"
              width={1536}
              height={1024}
              fetchPriority="high"
              className="size-full object-cover"
            />
          </picture>
          <div className="hero-glass-note">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <HugeiconsIcon icon={Leaf01Icon} size={21} aria-hidden="true" />
            </span>
            <div className="text-left">
              <p className="text-sm font-semibold">คัดด้วยใจ ส่งต่อจากสวน</p>
              <p lang="en" className="mt-1 text-xs text-muted-foreground">From good roots, with love.</p>
            </div>
          </div>
          <span lang="en" className="hero-side-note hidden md:block">A FRESHER WAY TO EVERYDAY.</span>
        </div>
      </section>

      <div className="border-y border-primary/10 bg-accent py-5">
        <Marquee
          repeat={4}
          pauseOnHover
          aria-hidden="true"
          className="suannn-brand-marquee [--duration:35s] [--gap:3rem] !p-0"
        >
          {['คัดจากสวน', 'รู้จักคนปลูก', 'โปร่งใสทุกที่มา', 'อร่อยอย่างสบายใจ'].map((text) => (
            <span key={text} className="flex shrink-0 items-center gap-12 text-sm text-secondary-foreground">
              {text}
              <HugeiconsIcon icon={Leaf01Icon} size={20} className="text-primary" aria-hidden="true" />
            </span>
          ))}
        </Marquee>
        <p className="sr-only">คัดจากสวน รู้จักคนปลูก โปร่งใสทุกที่มา อร่อยอย่างสบายใจ</p>
      </div>

      <section
        id="products"
        className="page-width scroll-mt-20 py-24 md:scroll-mt-28 md:py-36"
        aria-labelledby="products-title"
      >
        <div className="flex flex-col justify-between gap-7 md:flex-row md:items-end">
          <div>
            <p lang="en" className="mb-3 text-xs tracking-[0.18em] text-muted-foreground">
              A TASTE OF SUANNN
            </p>
            <h2 id="products-title" tabIndex={-1} className="section-heading">
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
              if (value.length) setCategory(value[0] as ProductCategory)
            }}
            className="max-w-full flex-wrap border bg-muted/50 p-1.5"
          >
            <ToggleGroupItem value="all" className={categoryItemClassName}>
              ทั้งหมด
            </ToggleGroupItem>
            <ToggleGroupItem value="fresh" className={categoryItemClassName}>
              ผลไม้สด
            </ToggleGroupItem>
            <ToggleGroupItem value="processed" className={categoryItemClassName}>
              แปรรูป
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {featured.isPending ? <div className="mt-10"><ProductRecommendationsSkeleton label="กำลังโหลดสินค้าแนะนำ" /></div> : null}
        {featured.isError ? <div role="alert" className="mt-8 flex flex-wrap items-center gap-3"><p>โหลดสินค้าแนะนำไม่ได้</p><Button variant="outline" onClick={() => void featured.refetch()}>ลองอีกครั้ง</Button></div> : null}
        {featured.data && !featured.isPlaceholderData && visibleProducts.length === 0 ? (
          <Empty className="mt-8 border py-12">
            <EmptyHeader><EmptyTitle>ยังไม่มีสินค้าในหมวดนี้</EmptyTitle><EmptyDescription>ลองดูหมวดอื่นก่อน แล้วกลับมาดูใหม่เร็ว ๆ นี้</EmptyDescription></EmptyHeader>
            <EmptyContent><Button variant="outline" onClick={() => setCategory('all')}>ดูสินค้าทั้งหมด</Button></EmptyContent>
          </Empty>
        ) : null}
        {visibleProducts.length > 0 ? (
          <div
            aria-busy={featured.isPlaceholderData}
            className={cn('mt-10 transition-opacity duration-200', featured.isPlaceholderData && 'opacity-60')}
          >
            <ProductRecommendations products={visibleProducts} label="สินค้าแนะนำ" />
            {category === 'all' && !featured.isPlaceholderData ? (
              <script type="application/ld+json">{productListJsonLd(visibleProducts)}</script>
            ) : null}
          </div>
        ) : null}
        {featured.data ? (
          <div className="mt-10 flex justify-center">
            <Link to={catalogLink.to} className={buttonVariants({ variant: 'outline', size: 'storefront' })}>
              {catalogLink.label} <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" aria-hidden="true" />
            </Link>
          </div>
        ) : null}
      </section>

      <section
        id="collections"
        className="page-width scroll-mt-20 pb-28 md:scroll-mt-28 md:pb-40"
        aria-labelledby="collections-title"
      >
        <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <h2 id="collections-title" tabIndex={-1} className="section-heading">
            วันนี้ อยากอร่อยแบบไหน
          </h2>
          <p lang="en" className="text-sm text-muted-foreground">A little something for every day.</p>
        </div>
        <div className="collection-accordion">
          {collections.map((collection, index) => {
            const active = activeCollection === index
            return (
              <article
                key={collection.title}
                className={cn('collection-panel group', active && 'is-active')}
                onMouseEnter={() => setActiveCollection(index)}
              >
                <picture className="contents">
                  <source type="image/avif" srcSet={`/images/collections/${collection.image.name}.avif`} />
                  <source type="image/webp" srcSet={`/images/collections/${collection.image.name}.webp`} />
                  <img
                    src={collection.image.fallback}
                    alt=""
                    width={collection.image.width}
                    height={collection.image.height}
                    loading="lazy"
                    className="absolute inset-0 size-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                </picture>
                <div className="collection-shade absolute inset-0" />
                <div className="collection-body">
                  <button
                    type="button"
                    className="collection-heading"
                    aria-expanded={active}
                    aria-controls={`collection-${index}`}
                    onClick={() => setActiveCollection(index)}
                    onFocus={() => setActiveCollection(index)}
                  >
                    <span lang="en" className="text-xs tracking-[0.15em]">{collection.subtitle}</span>
                    <span className="mt-3 block text-2xl font-medium">{collection.title}</span>
                  </button>
                  <div id={`collection-${index}`} className="collection-detail" inert={!active}>
                    <div className="collection-detail-content">
                      <p className="mb-5 text-sm">{collection.description}</p>
                      <Link to={collection.to} className={cn(buttonVariants({ variant: 'secondary' }), 'px-5')}>
                        เข้าไปดู <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section
        id="from-the-farm"
        className="farm-section scroll-mt-20 py-28 md:scroll-mt-28 md:py-40"
        aria-labelledby="farm-title"
      >
        <div className="page-width grid gap-14 lg:grid-cols-2 lg:gap-24">
          <div className="farm-intro self-start">
            <p lang="en" className="mb-5 text-xs tracking-[0.2em] text-primary-ink">CLOSER TO THE ROOTS</p>
            <h2 id="farm-title" tabIndex={-1} className="section-heading leading-[1.45]">
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
          <div
            className="farm-cards flex flex-col gap-6"
            style={{ '--timeline-scope': farmTimelines.join(', ') } as CSSProperties}
          >
            {principles.map((principle, index) => (
              <article
                key={principle.number}
                className="farm-card"
                style={{
                  '--i': index,
                  '--card-timeline': farmTimelines[index],
                  '--next-timeline': farmTimelines[index + 1] ?? 'none',
                } as CSSProperties}
              >
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
          <HugeiconsIcon icon={Leaf01Icon} size={40} className="mx-auto mb-7 text-primary" aria-hidden="true" />
          <h2 id="cta-title" className="section-heading">
            ให้ทุกวัน มีเรื่องดี ๆ จากสวน
          </h2>
          <p className="mt-5 text-sm leading-7 text-muted-foreground">
            เริ่มจากผลไม้ที่ชอบ แล้วค้นพบความตั้งใจของคนปลูก
          </p>
          <Link
            to="/products"
            className={cn(buttonVariants({ size: 'storefront' }), 'mt-8 px-8')}
          >
            ไปเดินสวนกัน <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" aria-hidden="true" />
          </Link>
          <span className="cta-wordmark" aria-hidden="true">
            suannn.
          </span>
        </div>
      </section>
    </div>
  )
}
