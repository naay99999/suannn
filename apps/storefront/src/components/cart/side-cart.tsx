import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ShoppingBag01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@workspace/ui/components/button'
import { SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, SheetClose } from '@workspace/ui/components/sheet'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from '@workspace/ui/components/empty'
import { formatStorePrice } from '@/lib/store-products'
import { getCartSummary } from '@/lib/cart'
import { StoreProductImage } from '@/components/store-product-image'
import { useCart } from './cart-context'
import { QuantityControl } from './quantity-control'

export function CartTrigger() {
  const { cart, triggerRef } = useCart()
  const { count } = getCartSummary(cart ?? { cartVersion: 0, lines: [] })
  return (
    <SheetTrigger render={<Button ref={triggerRef} variant="outline" size="icon-lg" className="relative rounded-full" />} aria-label={`เปิดตะกร้า ${count} ชิ้น`}>
      <HugeiconsIcon icon={ShoppingBag01Icon} />
      {count > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground">{count > 99 ? '99+' : count}</span>}
    </SheetTrigger>
  )
}

export function SideCart() {
  const { cart, pending, error, setItem, removeItem, mergeNotice, setOpen, triggerRef } = useCart()
  const { lines, count, subtotalSatang, hasUnavailable } = getCartSummary(cart ?? { cartVersion: 0, lines: [] })
  const canCheckout = lines.length > 0 && !hasUnavailable && !pending

  return (
    <SheetContent side="right" finalFocus={triggerRef} showCloseButton={false} className="suannn-store gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg motion-reduce:transition-none">
      <SheetHeader className="shrink-0 border-b p-6 pr-16">
        <SheetTitle>ตะกร้าจากสวน · {count} ชิ้น</SheetTitle>
        <SheetDescription>รายการและราคาจากข้อมูลปัจจุบันของร้าน</SheetDescription>
      </SheetHeader>
      <SheetClose render={<Button variant="ghost" size="icon-lg" className="absolute right-3 top-4" />} aria-label="ปิดตะกร้า"><HugeiconsIcon icon={Cancel01Icon} /></SheetClose>
      {pending && <p role="status" className="px-6 pt-4 text-sm text-muted-foreground">กำลังอัปเดตตะกร้า...</p>}
      {mergeNotice && <p role="status" className="px-6 pt-4 text-sm text-muted-foreground">{mergeNotice}</p>}
      {error && <p role="alert" className="px-6 pt-4 text-sm text-destructive">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
        {lines.length === 0 ? (
          <Empty className="h-full px-0">
            <EmptyHeader><EmptyTitle>ตะกร้ายังว่างอยู่</EmptyTitle><EmptyDescription>เลือกสินค้าจากร้านแล้วเพิ่มลงตะกร้าได้เลย</EmptyDescription></EmptyHeader>
            <EmptyContent><Button render={<Link to="/products" />} onClick={() => setOpen(false)}>ไปเลือกสินค้า</Button></EmptyContent>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-6">
            {lines.map(line => {
              const image = <StoreProductImage src={line.productImageUrl} alt={line.productImageAlt ?? line.productName ?? 'สินค้า'} className="size-full object-cover" />
              return (
                <li key={line.variantId} className="flex gap-4 border-b pb-6 last:border-0">
                  {line.productSlug
                    ? <Link to={`/products/${line.productSlug}`} onClick={() => setOpen(false)} className="size-20 shrink-0 self-start overflow-hidden rounded-xl">{image}</Link>
                    : <div className="size-20 shrink-0 self-start overflow-hidden rounded-xl">{image}</div>}
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {line.productSlug
                      ? <Link to={`/products/${line.productSlug}`} onClick={() => setOpen(false)} className="font-medium leading-6">{line.productName ?? 'สินค้า'}</Link>
                      : <p className="font-medium leading-6">{line.productName ?? 'สินค้า'}</p>}
                    <p className="text-xs text-muted-foreground">{line.variantName ?? 'ตัวเลือกสินค้า'}{line.unit ? ` · ${line.unit}` : ''}{line.priceSatang === null ? '' : ` · ${formatStorePrice(line.priceSatang)}`}</p>
                    {line.issues.length > 0 && <p role="status" className="text-xs text-destructive">{line.issues.includes('OUT_OF_STOCK') ? 'สินค้าไม่พอสำหรับจำนวนนี้' : 'รายการนี้ไม่พร้อมสั่งซื้อ'}</p>}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <QuantityControl label={line.productName ?? 'สินค้า'} quantity={line.quantity} onChange={value => { void setItem(line.variantId, value).catch(() => undefined) }} />
                      {line.totalSatang !== null && <span className="font-semibold text-primary-ink">{formatStorePrice(line.totalSatang!)}</span>}
                      <Button variant="ghost" size="sm" aria-label={`ลบ ${line.productName ?? 'สินค้า'}`} onClick={() => { void removeItem(line.variantId).catch(() => undefined) }}>ลบ</Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {lines.length > 0 && <SheetFooter className="shrink-0 gap-4 border-t p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-4"><span>ยอดรวมสินค้า</span><span className="text-xl font-semibold tabular-nums">{formatStorePrice(subtotalSatang)}</span></div>
        {hasUnavailable && <p role="status" className="text-xs leading-6 text-destructive">มีสินค้าไม่พร้อมสั่งซื้อ กรุณาลบรายการหรือปรับจำนวนก่อน checkout</p>}
        {canCheckout
          ? <Button render={<Link to="/checkout" />} nativeButton={false} size="storefront" onClick={() => setOpen(false)}>ตรวจสอบและชำระเงิน</Button>
          : <Button size="storefront" disabled>ตรวจสอบและชำระเงิน</Button>}
        <SheetClose render={<Button variant="outline" />}>เลือกสินค้าต่อ</SheetClose>
      </SheetFooter>}
    </SheetContent>
  )
}
