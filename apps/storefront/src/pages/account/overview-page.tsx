import type { ReactNode } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { cn } from '@workspace/ui/lib/utils'
import { authSessionQuery } from '@/lib/auth-session'
import { getCartSummary } from '@/lib/cart'
import { useCart } from '@/components/cart/cart-context'
import { StoreProductImage } from '@/components/store-product-image'
import { ButtonSpinner } from '@/components/loading/button-spinner'
import { useReorder } from '@/components/orders/use-reorder'
import type { CustomerOrder } from './account-api'
import { addressesQuery, ordersQuery, profileQuery } from './account-queries'
import { AccountQueryFeedback } from './account-query-feedback'
import { BrowseMorePanel } from './browse-more-panel'
import { AccountPageHeading, FulfilmentProgress, OrderStatus } from './account-ui'
import { accountSurface, accountSurfacePadding, standaloneTextLink, textLink } from './account-styles'
import { formatOrderDate, formatSatang, isActiveOrder, latestOrder, mergeOrderPages, orderQuantity } from './order-display'

const activeOrderLimit = 3

const byNewest = (a: CustomerOrder, b: CustomerOrder) => Date.parse(b.createdAt) - Date.parse(a.createdAt)

export function Component() {
  const session = useQuery(authSessionQuery).data
  const userId = session?.user.id ?? ''
  const profile = useQuery({ ...profileQuery(userId), enabled: Boolean(userId) })
  const addresses = useQuery({ ...addressesQuery(userId), enabled: Boolean(userId) })
  const orders = useInfiniteQuery({ ...ordersQuery(userId), enabled: Boolean(userId) })
  const allOrders = mergeOrderPages(orders.data?.pages ?? [])
  // Unpaid orders lead because they expire; the rest follow newest first.
  const activeOrders = allOrders.filter(isActiveOrder).sort((a, b) => Number(b.status === 'pending_payment') - Number(a.status === 'pending_payment') || byNewest(a, b))
  const lastDelivered = latestOrder(allOrders.filter(order => order.status === 'delivered'))
  const shipping = addresses.data?.items.find(address => address.isDefaultShipping)
  const { cart, error: cartError } = useCart()
  const cartLoading = !cart && !cartError
  const summary = cart ? getCartSummary(cart) : null
  const cartSummary = summary && summary.count > 0 ? summary : null

  if (profile.isError) return <AccountQueryFeedback error={profile.error} retry={() => void profile.refetch()} />
  const todos = [
    profile.data && !profile.data.emailVerified && { key: 'email', text: 'อีเมลยังไม่ได้ยืนยัน', to: '/account/profile', action: 'ส่งอีเมลยืนยันอีกครั้ง' },
    addresses.isSuccess && !shipping && { key: 'address', text: 'ยังไม่มีที่อยู่จัดส่งหลัก สั่งครั้งต่อไปจะต้องกรอกใหม่', to: '/account/addresses', action: 'เพิ่มที่อยู่' },
  ].filter(todo => todo !== false && todo !== undefined)

  return (
    <>
      <title>ภาพรวมบัญชี | suannn</title>
      {profile.data
        ? <AccountPageHeading title={`สวัสดี ${profile.data.name.split(' ')[0]}`} />
        : <div role="status" aria-label="กำลังโหลดข้อมูลบัญชี" className="mb-7"><Skeleton className="h-8 w-48 md:h-9" /></div>}
      {todos.length > 0 && <ul aria-label="สิ่งที่ต้องทำ" className="mb-8 flex flex-col gap-2">
        {todos.map(todo => <li key={todo.key} className="flex flex-wrap items-center gap-x-3 rounded-field bg-warning/10 px-4 py-1 text-sm text-warning-foreground dark:bg-warning/20">
          <HugeiconsIcon icon={Alert02Icon} className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{todo.text}</span>
          <Link to={todo.to} className="inline-flex min-h-11 items-center rounded-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">{todo.action}</Link>
        </li>)}
      </ul>}

      {orders.isPending || cartLoading ? <OrderRowsSkeleton /> : orders.isError ? <Section title="คำสั่งซื้อ">
        <AccountQueryFeedback error={orders.error} retry={() => void orders.refetch()} />
      </Section> : activeOrders.length > 0 ? <Section title="กำลังดำเนินการ" count={activeOrders.length} action={<AllOrdersLink />}>
        <ul className={cn('divide-y overflow-hidden', accountSurface)}>
          {activeOrders.slice(0, activeOrderLimit).map(order => <ActiveOrderRow key={order.id} order={order} />)}
        </ul>
        {activeOrders.length > activeOrderLimit && <p className="mt-3 text-sm text-muted-foreground">และอีก {activeOrders.length - activeOrderLimit} รายการในหน้าคำสั่งซื้อ</p>}
        {cartSummary && <CartStrip summary={cartSummary} />}
      </Section> : cartSummary ? null : lastDelivered ? <ReorderCard order={lastDelivered} />
        : <p className="rounded-surface border border-dashed px-5 py-4 text-sm text-muted-foreground md:px-6">
          {allOrders.length ? 'ไม่มีคำสั่งซื้อที่ค้างอยู่' : 'ยังไม่มีคำสั่งซื้อ ของที่สั่งจะแสดงสถานะการจัดส่งที่นี่'}
          {allOrders.length > 0 && <> · <Link to="/account/orders" className={textLink}>ดูคำสั่งซื้อทั้งหมด</Link></>}
        </p>}
      {cartSummary && !orders.isPending && (orders.isError || activeOrders.length === 0) && <CartSummaryCard summary={cartSummary} className={cn(orders.isError && 'mt-8')} />}

      <div className="mt-10">
        {cartSummary
          ? <BrowseMorePanel title="เติมอีกนิดก่อนชำระ" description="ของใหม่จากสวนที่ส่งไปพร้อมกันได้ในรอบนี้" />
          : <BrowseMorePanel title="เลือกของเพิ่ม" description="ผลผลิตใหม่จากสวนที่เราดูแลในฤดูนี้" />}
      </div>
    </>
  )
}

function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">{title}{count !== undefined && <span className="ml-2 font-normal tabular-nums text-muted-foreground">({count})</span>}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function ActiveOrderRow({ order }: { order: CustomerOrder }) {
  return (
    <li className="group relative flex flex-col gap-4 px-5 py-4 transition-colors md:px-6 hover:bg-accent/50 motion-reduce:transition-none">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <Link to={`/account/orders/${order.id}`} className="font-medium rounded-sm after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-ring">{order.orderNumber}</Link>
          <p className="mt-1 text-sm text-muted-foreground">{formatOrderDate(order.createdAt)} · {orderQuantity(order)} ชิ้น · <span className="tabular-nums">{formatSatang(order.totalSatang)}</span></p>
        </div>
        <div className="flex items-center gap-3">
          <OrderStatus status={order.status} />
          {order.status === 'pending_payment'
            ? <span className="flex items-center gap-1 text-sm font-medium text-primary-ink">ชำระเงินต่อ<HugeiconsIcon icon={ArrowRight01Icon} className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" /></span>
            : <HugeiconsIcon icon={ArrowRight01Icon} className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />}
        </div>
      </div>
      <FulfilmentProgress status={order.status} />
    </li>
  )
}

function OrderRowsSkeleton() {
  return (
    <div role="status" aria-label="กำลังโหลดคำสั่งซื้อ" className={cn('divide-y', accountSurface)}>
      {[0, 1].map(row => <div key={row} className="flex flex-col gap-3 px-5 py-4 md:px-6"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-56" /><Skeleton className="h-2 w-full" /></div>)}
    </div>
  )
}

type CartSummary = ReturnType<typeof getCartSummary>

function AllOrdersLink() {
  return <Link to="/account/orders" className={cn(standaloneTextLink, 'text-sm')}>ดูคำสั่งซื้อทั้งหมด</Link>
}

const thumbnailLimit = 4

// Shows every line when they fit, otherwise the first few plus a "+N" tile.
function CartThumbnails({ lines, size }: { lines: CartSummary['lines']; size: 'sm' | 'lg' }) {
  const shown = lines.length > thumbnailLimit ? lines.slice(0, thumbnailLimit - 1) : lines
  const hidden = lines.length - shown.length
  const tile = cn('shrink-0 overflow-hidden rounded-field bg-muted ring-2 ring-background', size === 'lg' ? 'size-16 md:size-20' : 'size-9')
  return (
    <ul aria-label="สินค้าในตะกร้า" className={cn('flex', size === 'lg' ? 'gap-2' : '*:not-first:-ml-2')}>
      {shown.map(line => <li key={line.variantId} className={tile}>
        <StoreProductImage src={line.productImageUrl} alt={line.productImageAlt ?? line.productName ?? 'สินค้า'} className="size-full object-cover text-[0px]" />
      </li>)}
      {hidden > 0 && <li className={cn(tile, 'grid place-items-center font-semibold tabular-nums text-muted-foreground', size === 'lg' ? 'text-base' : 'text-xs')}>
        +{hidden}<span className="sr-only"> รายการ</span>
      </li>}
    </ul>
  )
}

function CartSummaryCard({ summary, className }: { summary: CartSummary; className?: string }) {
  const { setOpen } = useCart()
  return (
    <section aria-labelledby="cart-summary-title" className={cn(accountSurface, accountSurfacePadding, className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 id="cart-summary-title" className="text-lg font-semibold">ของในตะกร้ารอคุณอยู่</h3>
        <button type="button" onClick={() => setOpen(true)} className={cn(standaloneTextLink, 'text-sm')}>ดูตะกร้า</button>
      </div>
      <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-4">
          <CartThumbnails lines={summary.lines} size="lg" />
          <div>
            <p className="text-sm text-muted-foreground">{summary.lines.length} รายการ · {summary.count} ชิ้น</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatSatang(summary.subtotalSatang)}</p>
            <p className="text-xs text-muted-foreground">ยังไม่รวมค่าจัดส่ง</p>
          </div>
        </div>
        {summary.hasUnavailable
          ? <div className="flex flex-col items-start gap-3 sm:items-end">
            <p role="status" className="flex items-center gap-2 text-sm text-warning-foreground"><HugeiconsIcon icon={Alert02Icon} className="size-4 shrink-0" aria-hidden="true" />มีบางรายการที่สั่งไม่ได้แล้ว</p>
            <Button size="storefront" className="w-full sm:w-auto" onClick={() => setOpen(true)}>ตรวจสอบตะกร้า</Button>
          </div>
          : <Link to="/checkout" className={cn(buttonVariants({ size: 'storefront' }), 'w-full sm:w-auto')}>
            ไปชำระเงิน <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
          </Link>}
      </div>
    </section>
  )
}

function CartStrip({ summary }: { summary: CartSummary }) {
  const { setOpen } = useCart()
  const linkClassName = standaloneTextLink
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-field bg-accent px-4 py-2 text-sm">
      <CartThumbnails lines={summary.lines} size="sm" />
      <p className="min-w-0 flex-1">มีของในตะกร้า {summary.count} ชิ้น · <span className="font-semibold tabular-nums">{formatSatang(summary.subtotalSatang)}</span></p>
      {summary.hasUnavailable
        ? <button type="button" onClick={() => setOpen(true)} className={linkClassName}>ตรวจสอบตะกร้า</button>
        : <Link to="/checkout" className={linkClassName}>ไปชำระเงิน<HugeiconsIcon icon={ArrowRight01Icon} className="size-4" aria-hidden="true" /></Link>}
    </div>
  )
}

function ReorderCard({ order }: { order: CustomerOrder }) {
  const { reorder, pending, message } = useReorder(order)
  const names = [...new Set(order.items.map(item => item.productName))]
  return (
    <section aria-labelledby="reorder-title" className={cn(accountSurface, accountSurfacePadding)}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 id="reorder-title" className="text-lg font-semibold">สั่งของเดิมอีกครั้งไหม</h3>
        <AllOrdersLink />
      </div>
      <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="leading-7">{names.slice(0, 3).join(', ')}{names.length > 3 && <span className="text-muted-foreground"> และอีก {names.length - 3} รายการ</span>}</p>
          <p className="mt-1 text-sm text-muted-foreground">{order.orderNumber} · สั่งเมื่อ {formatOrderDate(order.createdAt)} · <span className="tabular-nums">{formatSatang(order.totalSatang)}</span></p>
        </div>
        <Button size="storefront" className="w-full shrink-0 sm:w-auto" disabled={pending} onClick={() => void reorder()}><ButtonSpinner show={pending} />{pending ? 'กำลังเพิ่มลงตะกร้า...' : 'สั่งซ้ำ'}</Button>
      </div>
      {message && <p role="alert" className="mt-3 text-sm text-destructive">{message}</p>}
    </section>
  )
}
