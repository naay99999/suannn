import { Link } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ShoppingBag01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@workspace/ui/components/button'
import { SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, SheetClose } from '@workspace/ui/components/sheet'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from '@workspace/ui/components/empty'
import { formatPrice } from '@/lib/catalog'
import { getCartSummary } from '@/lib/cart'
import { useCart } from './cart-context'
import { QuantityControl } from './quantity-control'

export function CartTrigger() {
  const { items, triggerRef } = useCart()
  const { count } = getCartSummary(items)
  return (
    <SheetTrigger render={<Button ref={triggerRef} variant="outline" size="icon-lg" className="relative rounded-full" />} aria-label={`เปิดตะกร้า ${count} ชิ้น`}>
      <HugeiconsIcon icon={ShoppingBag01Icon} />
      {count > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground">{count > 99 ? '99+' : count}</span>}
    </SheetTrigger>
  )
}

export function SideCart() {
  const { items, dispatch, setOpen, storageError, triggerRef } = useCart()
  const { lines, count, subtotal } = getCartSummary(items)
  return (
    <SheetContent side="right" finalFocus={triggerRef} showCloseButton={false} className="suannn-store gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg motion-reduce:transition-none">
      <SheetHeader className="shrink-0 border-b p-6 pr-16">
        <SheetTitle>ตะกร้าจากสวน · {count} ชิ้น</SheetTitle>
        <SheetDescription>เก็บของอร่อยที่เลือกไว้ด้วยกัน</SheetDescription>
      </SheetHeader>
      <SheetClose render={<Button variant="ghost" size="icon-lg" className="absolute right-3 top-4" />} aria-label="ปิดตะกร้า"><HugeiconsIcon icon={Cancel01Icon} /></SheetClose>
      {storageError && <p role="status" className="px-6 pt-4 text-sm text-destructive">เบราว์เซอร์ไม่อนุญาตให้บันทึก ตะกร้าจะอยู่จนกว่าจะรีเฟรชหน้านี้</p>}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
        {lines.length === 0 ? (
          <Empty className="h-full px-0">
            <EmptyHeader><EmptyTitle>ตะกร้ายังว่างอยู่</EmptyTitle><EmptyDescription>เลือกผลไม้หรือของอร่อยจากสวน แล้วเพิ่มลงตะกร้าได้เลย</EmptyDescription></EmptyHeader>
            <EmptyContent><Button render={<Link to="/products" />} onClick={() => setOpen(false)}>ไปเลือกของอร่อย</Button></EmptyContent>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-6">
            {lines.map(({ product, quantity, total }) => (
              <li key={product.id} className="flex gap-4 border-b pb-6 last:border-0">
                <Link to={`/products/${product.id}`} onClick={() => setOpen(false)} className="shrink-0 self-start overflow-hidden rounded-xl">
                  <img src={product.images[0].src} alt={product.images[0].alt} width={80} height={96} className="h-24 w-20 object-cover" />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Link to={`/products/${product.id}`} onClick={() => setOpen(false)} className="font-medium leading-6">{product.name}</Link>
                  <p className="text-xs text-muted-foreground">{product.unit} · {formatPrice(product.price)} / แพ็ก</p>
                  <p className="font-semibold text-primary-ink">{formatPrice(total)}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <QuantityControl label={product.name} quantity={quantity} onChange={value => dispatch({ type: 'quantity', productId: product.id, quantity: value })} />
                    <Button variant="ghost" size="sm" aria-label={`ลบ ${product.name}`} onClick={() => dispatch({ type: 'remove', productId: product.id })}>ลบ</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {lines.length > 0 && <SheetFooter className="shrink-0 gap-4 border-t p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-4"><span>ยอดรวมสินค้า</span><span className="text-xl font-semibold tabular-nums">{formatPrice(subtotal)}</span></div>
        <p className="text-xs leading-6 text-muted-foreground">ราคาและสินค้าเป็นตัวอย่าง ยังไม่รวมค่าจัดส่ง และยังไม่เปิดชำระเงินจริง</p>
        <SheetClose render={<Button variant="outline" />}>เลือกสินค้าต่อ</SheetClose>
      </SheetFooter>}
    </SheetContent>
  )
}
