import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { buttonVariants } from '@workspace/ui/components/button'
import { authSessionQuery } from '@/lib/auth-session'
import { addressesQuery, ordersQuery, profileQuery } from './account-queries'
import { AccountQueryFeedback } from './account-query-feedback'
import { AccountPageHeading, AddressText, OrderStatus } from './account-ui'
import { formatOrderDate, formatSatang, latestOrder, mergeOrderPages } from './order-display'

const shortcuts = [
  { to: '/account/orders', title: 'คำสั่งซื้อ', description: 'ย้อนดูของอร่อยที่เคยเลือก' },
  { to: '/account/addresses', title: 'ที่อยู่', description: 'จัดการปลายทางการจัดส่ง' },
  { to: '/account/profile', title: 'ข้อมูลส่วนตัว', description: 'ตรวจข้อมูลติดต่อของคุณ' },
]

export function Component() {
  const session = useQuery(authSessionQuery).data
  const userId = session?.user.id ?? ''
  const profile = useQuery({ ...profileQuery(userId), enabled: Boolean(userId) })
  const addresses = useQuery({ ...addressesQuery(userId), enabled: Boolean(userId) })
  const orders = useInfiniteQuery({ ...ordersQuery(userId), enabled: Boolean(userId) })
  const latest = latestOrder(mergeOrderPages(orders.data?.pages ?? []))
  const shipping = addresses.data?.items.find(address => address.isDefaultShipping)

  if (profile.isError) return <AccountQueryFeedback error={profile.error} retry={() => void profile.refetch()} />
  return (
    <>
      <title>ภาพรวมบัญชี | suannn</title>
      <AccountPageHeading title={profile.data ? `สวัสดี ${profile.data.name.split(' ')[0]}` : 'บัญชีของคุณ'} description="เลือกดูข้อมูลที่คุณต้องการจากพื้นที่นี้" />
      {!profile.data && <p role="status" className="mb-6 text-muted-foreground">กำลังโหลดข้อมูลบัญชี...</p>}
      {profile.data && !profile.data.emailVerified && <div className="mb-7 rounded-2xl bg-accent p-5 text-sm">อีเมลยังไม่ได้ยืนยัน <Link to="/account/security" className="font-medium text-primary-ink underline underline-offset-4">ส่งอีเมลยืนยันอีกครั้ง</Link></div>}
      <div className="grid grid-flow-dense gap-4 sm:grid-cols-3">
        {shortcuts.map(shortcut => <Card key={shortcut.to} className="group relative transition-colors hover:border-primary/40 motion-reduce:transition-none">
          <CardHeader><CardTitle className="text-lg">{shortcut.title}</CardTitle><CardDescription>{shortcut.description}</CardDescription><CardAction><HugeiconsIcon icon={ArrowRight01Icon} className="size-4 text-primary-ink transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden="true" /></CardAction></CardHeader>
          <CardContent className="mt-auto"><Link to={shortcut.to} className="font-medium text-primary-ink underline underline-offset-4 after:absolute after:inset-0">เปิดดู<span className="sr-only"> {shortcut.title}</span></Link></CardContent>
        </Card>)}
      </div>
      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-lg">รายการล่าสุด</CardTitle><CardDescription>คำสั่งซื้อในบัญชีของคุณ</CardDescription></CardHeader>
          <CardContent className="gap-5">
            {orders.isPending ? <p role="status" className="text-muted-foreground">กำลังโหลดคำสั่งซื้อ...</p> : orders.isError ? <AccountQueryFeedback error={orders.error} retry={() => void orders.refetch()} /> : latest ? <>
              <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-medium">{latest.orderNumber}</p><OrderStatus status={latest.status} /></div>
              <p className="text-sm text-muted-foreground">{formatOrderDate(latest.createdAt)} · {latest.items.reduce((sum, item) => sum + item.quantity, 0)} ชิ้น</p>
              <p className="text-xl font-semibold tabular-nums">{formatSatang(latest.totalSatang)}</p>
              <Link to={`/account/orders/${latest.id}`} className="font-medium text-primary-ink underline underline-offset-4">ดูรายละเอียด</Link>
            </> : <p className="text-sm text-muted-foreground">ยังไม่มีคำสั่งซื้อ</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg">ที่อยู่จัดส่งหลัก</CardTitle><CardDescription>ปลายทางที่บันทึกไว้ในบัญชี</CardDescription></CardHeader>
          <CardContent className="gap-4">
            {addresses.isPending ? <p role="status" className="text-muted-foreground">กำลังโหลดที่อยู่...</p> : addresses.isError ? <AccountQueryFeedback error={addresses.error} retry={() => void addresses.refetch()} /> : shipping ? <>
              <p className="font-medium">{shipping.recipientName}</p><p className="text-sm text-muted-foreground"><AddressText address={shipping} /></p>
            </> : <p className="text-sm text-muted-foreground">ยังไม่มีที่อยู่หลัก</p>}
            <Link to="/account/addresses" className="font-medium text-primary-ink underline underline-offset-4">จัดการที่อยู่</Link>
          </CardContent>
        </Card>
      </div>
      <div className="mt-8 rounded-3xl bg-accent p-7 md:p-9"><h3 className="text-xl font-semibold">กลับไปเลือกของอร่อยจากสวน</h3><p className="mt-2 text-sm leading-7 text-muted-foreground">ดูสิ่งที่กำลังอยู่ในฤดูกาลนี้</p><Link to="/products" className={`${buttonVariants({ size: 'storefront' })} mt-6`}>เลือกสินค้า</Link></div>
    </>
  )
}
