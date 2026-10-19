import { useLocation } from 'react-router'
import { Separator } from '@workspace/ui/components/separator'
import { SidebarTrigger } from '@workspace/ui/components/sidebar'

const sectionTitles = [
  ['/dashboard', 'ภาพรวม'],
  ['/orders', 'คำสั่งซื้อ'],
  ['/products', 'สินค้า'],
  ['/farms', 'ฟาร์ม'],
  ['/inventory', 'สต็อก'],
  ['/customers', 'ลูกค้า'],
  ['/audit', 'บันทึกกิจกรรม'],
  ['/settings', 'ตั้งค่า'],
] as const

export function SiteHeader() {
  const { pathname } = useLocation()
  const title = sectionTitles.find(([url]) => pathname === url || pathname.startsWith(`${url}/`))?.[1] ?? 'Admin'

  return (
    <header className='flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)'>
      <div className='flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6'>
        <SidebarTrigger className='-ml-1' />
        <Separator
          orientation='vertical'
          className='mx-2 h-4 data-vertical:self-auto'
        />
        <h1 className='text-base font-medium'>{title}</h1>
      </div>
    </header>
  )
}
