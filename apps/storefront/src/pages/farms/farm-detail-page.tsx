import { useRef } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@workspace/ui/components/breadcrumb'
import { FarmImage } from '@/components/farms/farm-image'
import { ProductCard } from '@/components/product-card'
import { getStoreFarm, getStoreFarmProducts, StoreFarmRequestError, storeFarmDetailQueryKey, storeFarmProductsQueryKey } from '@/lib/store-farms'
import { FarmStory } from './_components/farm-story'
import { useFarmMotion } from './_components/use-farm-motion'

export function Component() {
  const { slug = '' } = useParams()
  const scope = useRef<HTMLDivElement>(null)
  useFarmMotion(scope, slug)
  const farm = useQuery({ queryKey: storeFarmDetailQueryKey(slug), queryFn: () => getStoreFarm(slug), enabled: Boolean(slug) })
  const products = useInfiniteQuery({
    queryKey: storeFarmProductsQueryKey(slug, { limit: 12 }),
    queryFn: ({ pageParam }) => getStoreFarmProducts(slug, { limit: 12, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: Boolean(farm.data),
  })
  const items = products.data?.pages.flatMap(page => page.items) ?? []

  if (farm.isPending) return <div ref={scope} className="w-full max-w-full overflow-x-clip"><p role="status" className="py-20 text-center text-muted-foreground">กำลังโหลดข้อมูลสวน...</p></div>
  if (farm.isError && farm.error instanceof StoreFarmRequestError && farm.error.status === 404) return (
    <div ref={scope} className="w-full max-w-full overflow-x-clip"><Empty className="min-h-[50svh]">
      <EmptyHeader><EmptyTitle><h1>ไม่พบโปรไฟล์สวนนี้</h1></EmptyTitle><EmptyDescription>สวนนี้อาจยังไม่เปิดเผยข้อมูลหรือไม่มีอยู่ในร้าน</EmptyDescription></EmptyHeader>
      <EmptyContent><Link className={buttonVariants()} to="/farms">กลับไปดูสวนทั้งหมด</Link></EmptyContent>
    </Empty></div>
  )
  if (farm.isError || !farm.data) return <div ref={scope} className="w-full max-w-full overflow-x-clip"><div role="alert" className="flex flex-wrap items-center justify-center gap-3 py-20"><p>โหลดข้อมูลสวนไม่ได้</p><Button variant="outline" onClick={() => void farm.refetch()}>ลองอีกครั้ง</Button></div></div>

  const profile = farm.data
  const location = [profile.district, profile.province].filter(Boolean).join(' · ')
  return (
    <div ref={scope} className="w-full max-w-full overflow-x-clip">
      <title>{`${profile.name} | suannn`}</title>
      <div className="page-width">
        <Breadcrumb aria-label="เส้นทางหน้าโปรไฟล์สวน">
          <BreadcrumbList><BreadcrumbItem><BreadcrumbLink render={<Link to="/" />}>หน้าแรก</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink render={<Link to="/farms" />}>สวนและคนปลูก</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{profile.name}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList>
        </Breadcrumb>
        <section className="grid items-center gap-8 py-8 md:grid-cols-[0.9fr_1.1fr] md:gap-14 md:py-14" aria-labelledby="farm-title">
          <div className="md:order-2">
            <FarmImage src={profile.coverImageUrl} alt={profile.coverImageAlt} demo={profile.isDemo} loading="eager" className="aspect-[5/4] rounded-[2rem]" />
          </div>
          <div className="farm-reveal md:order-1">
            <p className="mb-4 text-sm font-medium text-primary-ink">{location || 'แหล่งผลิตของ suannn'}</p>
            <h1 id="farm-title" className="max-w-6xl text-[clamp(2.4rem,5.5vw,4.8rem)] font-semibold leading-[1.35] tracking-tight" style={{ fontFamily: "'Cabinet Grotesk', 'Noto Sans Thai Variable', var(--font-family-brand), sans-serif" }}>{profile.name}</h1>
            {profile.farmerName && <p className="mt-5 text-lg text-muted-foreground">ดูแลโดย {profile.farmerName}</p>}
            {profile.summary && <p className="farm-reveal mt-6 max-w-2xl text-base leading-8 text-muted-foreground">{profile.summary}</p>}
            <p className="mt-7 max-w-2xl border-l-2 border-primary pl-4 text-sm leading-7 text-muted-foreground">สวนที่แสดงคือแหล่งผลิตที่เชื่อมกับสินค้าในระดับสินค้า รายการนี้ยังไม่ระบุว่าสินค้าแต่ละล็อตที่จัดส่งมาจากสวนใด</p>
          </div>
        </section>
        <FarmStory farm={profile} />
        <section className="border-t py-12 md:py-16" aria-labelledby="farm-products-title">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div><h2 id="farm-products-title" className="text-3xl font-semibold tracking-tight md:text-4xl">สินค้าที่เชื่อมกับสวนนี้</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">แหล่งผลิตระดับสินค้า อาจมีสินค้ารายการเดียวกันจากหลายสวน</p></div>
            <Link className={buttonVariants({ variant: 'outline' })} to="/farms">สวนทั้งหมด</Link>
          </div>
          {products.isPending && <p role="status" className="py-8 text-muted-foreground">กำลังโหลดสินค้า...</p>}
          {products.isError && <div role="alert" className="flex flex-wrap items-center gap-3 py-8"><p>โหลดสินค้าในสวนไม่ได้</p><Button variant="outline" onClick={() => void products.refetch()}>ลองอีกครั้ง</Button></div>}
          {products.data && items.length === 0 && <Empty className="border py-10"><EmptyHeader><EmptyTitle>ยังไม่มีสินค้าที่แสดงในร้าน</EmptyTitle><EmptyDescription>สวนนี้ยังไม่มีสินค้าที่เผยแพร่พร้อมแสดง</EmptyDescription></EmptyHeader><EmptyContent><Link className={buttonVariants({ variant: 'outline' })} to="/products">เลือกดูสินค้าทั้งหมด</Link></EmptyContent></Empty>}
          {items.length > 0 && <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">{items.map(product => <ProductCard key={product.id} product={product} />)}</div>}
          {products.hasNextPage && <div className="mt-10 text-center"><Button variant="outline" disabled={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()}>{products.isFetchingNextPage ? 'กำลังโหลด...' : 'ดูสินค้าเพิ่มเติม'}</Button></div>}
          {products.isFetchNextPageError && <p role="alert" className="mt-4 text-center text-sm text-destructive">โหลดสินค้าเพิ่มเติมไม่ได้ ลองกดอีกครั้ง</p>}
        </section>
      </div>
    </div>
  )
}
