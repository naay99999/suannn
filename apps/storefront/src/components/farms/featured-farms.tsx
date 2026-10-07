import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { getStoreFarms, storeFarmListQueryKey } from '@/lib/store-farms'
import { FarmGrowerCarousel } from '@/pages/farms/_components/farm-grower-carousel'

export function FeaturedFarms() {
  const farms = useQuery({ queryKey: storeFarmListQueryKey({ limit: 3 }), queryFn: () => getStoreFarms({ limit: 3 }) })
  return (
    <div className="page-width mt-20 border-t border-primary/10 pt-16 md:mt-28 md:pt-20">
      <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
        <div><h3 className="text-3xl font-semibold tracking-tight md:text-4xl">รู้จักคนปลูกและสวน</h3><p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">เปิดดูข้อมูลแหล่งผลิตที่เชื่อมกับสินค้า อ่านเรื่องราวของสวนและวิธีดูแลผลผลิต</p></div>
        <Link to="/farms" className={buttonVariants({ variant: 'outline' })}>ดูสวนทั้งหมด</Link>
      </div>
      {farms.isPending && <p role="status" className="py-10 text-muted-foreground">กำลังโหลดข้อมูลสวน...</p>}
      {farms.isError && <div role="alert" className="flex flex-wrap items-center gap-3 py-8"><p>โหลดข้อมูลสวนไม่ได้</p><Button variant="outline" onClick={() => void farms.refetch()}>ลองอีกครั้ง</Button></div>}
      {farms.data && farms.data.items.length === 0 && <div className="rounded-2xl border p-6"><p className="font-medium">ยังไม่มีโปรไฟล์สวนที่เผยแพร่</p><p className="mt-2 text-sm text-muted-foreground">ดูสินค้าในร้านได้ตามปกติ และกลับมารู้จักสวนได้เมื่อมีข้อมูล</p></div>}
      {farms.data && farms.data.items.length > 0 && <FarmGrowerCarousel farms={farms.data.items} />}
    </div>
  )
}
