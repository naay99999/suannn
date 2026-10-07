import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { FarmCard } from '@/components/farms/farm-card'
import { FarmImage } from '@/components/farms/farm-image'
import { getStoreFarms, storeFarmListQueryKey } from '@/lib/store-farms'

export function Component() {
  const farms = useInfiniteQuery({
    queryKey: storeFarmListQueryKey({ limit: 12 }),
    queryFn: ({ pageParam }) => getStoreFarms({ limit: 12, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
  })
  const items = farms.data?.pages.flatMap(page => page.items) ?? []
  const lead = items[0]

  return (
    <div className="w-full max-w-full overflow-x-clip">
      <title>รู้จักสวนของเรา | suannn</title>
      <section className="page-width grid items-center gap-8 pb-16 pt-4 md:grid-cols-[1.1fr_0.9fr] md:gap-14 md:pb-24 md:pt-10" aria-labelledby="farms-title">
        <div>
          <p className="mb-5 text-sm font-medium text-primary-ink">คนปลูก · สถานที่ · เรื่องราว</p>
          <h1 id="farms-title" className="max-w-6xl text-[clamp(2.6rem,6vw,5.4rem)] font-semibold leading-[1.3] tracking-tight" style={{ fontFamily: "'Cabinet Grotesk', 'Satoshi', 'Noto Sans Thai Variable', var(--font-family-brand), sans-serif" }}>
            รู้จักสวนที่อยู่เบื้องหลังผลผลิต
          </h1>
          <p className="mt-6 max-w-xl text-base leading-8 text-muted-foreground md:text-lg">
            ทำความรู้จักเกษตรกรและแหล่งปลูกของสินค้าที่คัดสรรจากหลายสวน ข้อมูลนี้แสดงระดับสินค้า ยังไม่ระบุสวนของล็อตที่จัดส่ง
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className={buttonVariants({ size: 'lg' })} to="/products">เลือกดูสินค้า</Link>
            <a className={buttonVariants({ size: 'lg', variant: 'outline' })} href="#farm-list">รู้จักสวน</a>
          </div>
        </div>
        <div className="relative md:-mr-12">
          <FarmImage src={lead?.coverImageUrl ?? '/images/hero.jpg'} alt={lead?.coverImageAlt ?? 'ภาพประกอบบรรยากาศสวน'} demo={lead?.isDemo} loading="eager" className="aspect-[5/4] rounded-[2rem] shadow-xl shadow-primary/10" />
          <p className="mt-3 text-right text-xs text-muted-foreground">ภาพและข้อมูลสวนสาธิตจะแสดงป้ายกำกับไว้เสมอ</p>
        </div>
      </section>

      <section id="farm-list" className="page-width scroll-mt-28 py-16 md:py-24" aria-labelledby="farm-list-title">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h2 id="farm-list-title" className="text-3xl font-semibold tracking-tight md:text-4xl">สวนและคนปลูก</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">เลือกดูโปรไฟล์ของสวน เพื่ออ่านที่มา วิธีดูแล และสินค้าที่เชื่อมโยงกับสวน</p>
          </div>
          <Link className={buttonVariants({ variant: 'link' })} to="/products">กลับไปเลือกสินค้า</Link>
        </div>
        {farms.isPending && <p role="status" className="py-12 text-center text-muted-foreground">กำลังโหลดรายชื่อสวน...</p>}
        {farms.isError && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border p-6"><p>โหลดรายชื่อสวนไม่ได้</p><Button variant="outline" onClick={() => void farms.refetch()}>ลองอีกครั้ง</Button></div>}
        {farms.data && items.length === 0 && <Empty className="border py-12">
          <EmptyHeader><EmptyTitle>ยังไม่มีสวนที่เปิดเผยโปรไฟล์</EmptyTitle><EmptyDescription>กลับมาดูใหม่เมื่อมีสวนเผยแพร่ข้อมูล</EmptyDescription></EmptyHeader>
          <EmptyContent><Link className={buttonVariants({ variant: 'outline' })} to="/products">เลือกดูสินค้าทั้งหมด</Link></EmptyContent>
        </Empty>}
        {items.length >= 6 && <>
          <div className="grid grid-flow-dense gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-12 lg:grid-rows-2">
            {items.slice(0, 6).map((farm, index) => <div key={farm.id} className={[
              'min-w-0',
              index === 0 ? 'lg:col-span-6' : index < 3 ? 'lg:col-span-3' : 'lg:col-span-4',
            ].join(' ')}><FarmCard farm={farm} /></div>)}
          </div>
          {items.length > 6 && <div className="mt-14 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {items.slice(6).map(farm => <FarmCard key={farm.id} farm={farm} />)}
          </div>}
        </>}
        {items.length > 0 && items.length < 6 && <div className="grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(farm => <FarmCard key={farm.id} farm={farm} />)}
        </div>}
        {farms.hasNextPage && <div className="mt-12 text-center"><Button variant="outline" disabled={farms.isFetchingNextPage} onClick={() => void farms.fetchNextPage()}>{farms.isFetchingNextPage ? 'กำลังโหลด...' : 'ดูสวนเพิ่มเติม'}</Button></div>}
        {farms.isFetchNextPageError && <p role="alert" className="mt-4 text-center text-sm text-destructive">โหลดสวนเพิ่มเติมไม่ได้ ลองกดอีกครั้ง</p>}
      </section>
    </div>
  )
}
