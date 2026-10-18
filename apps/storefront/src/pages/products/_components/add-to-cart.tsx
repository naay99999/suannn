import { useRef, useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { useCart } from '@/components/cart/cart-context'
import { QuantityControl } from '@/components/cart/quantity-control'
import { MAX_QUANTITY } from '@/lib/cart'
import { formatStorePrice, type StoreProductDetail } from '@/lib/store-products'
import { useStickyVisibility } from '@/lib/use-sticky-visibility'

export function AddToCart({ product, variant }: {
  product: StoreProductDetail
  variant: StoreProductDetail['variants'][number] | undefined
}) {
  const [quantity, setQuantity] = useState(1)
  const { cart, pending, setItem, setOpen } = useCart()
  const existingQuantity = cart?.lines.find(line => line.variantId === variant?.id)?.quantity ?? 0
  const remaining = Math.max(0, MAX_QUANTITY - existingQuantity)
  const available = Boolean(product.canPurchase && variant?.canPurchase)
  const selected = Math.min(quantity, Math.max(1, remaining))
  const actions = useRef<HTMLDivElement>(null)
  const sticky = useStickyVisibility(actions)
  const label = !available ? 'ยังไม่พร้อมสั่งซื้อ' : remaining === 0 ? 'ครบจำนวนสูงสุดในตะกร้า' : 'เพิ่มลงตะกร้า'
  const disabled = !available || remaining === 0 || pending

  async function add() {
    if (!variant || !available || remaining < 1) return
    setOpen(true)
    try {
      await setItem(variant.id, existingQuantity + selected)
      setQuantity(1)
    } catch { /* Cart context exposes the actionable request error inside the open sheet. */ }
  }

  return (
    <div className="my-6 flex flex-col gap-3">
      <div ref={actions} className="flex flex-wrap gap-3">
        {available && remaining > 0 && <QuantityControl label={product.name} quantity={selected} max={remaining} onChange={setQuantity} />}
        <Button className="flex-1" disabled={disabled} onClick={() => { void add() }}>
          {label}
        </Button>
      </div>
      {remaining > 0 && available && <p className="text-xs text-muted-foreground">เลือกจำนวนที่ต้องการได้ สูงสุด {MAX_QUANTITY} ชิ้นต่อรายการ</p>}
      {available && variant && <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl transition-transform duration-300 ease-out',
          !sticky && 'translate-y-full',
        )}
        aria-hidden={!sticky}
        inert={!sticky}
      >
        <div className="page-width flex flex-col items-stretch gap-2 py-3 md:flex-row-reverse md:items-center md:justify-between md:gap-6">
          <Button size="storefront" className="px-10 text-base md:min-w-64" disabled={disabled} onClick={() => { void add() }}>
            {label}
          </Button>
          <p className="truncate text-center text-sm text-muted-foreground md:text-left">
            <span className="hidden font-medium text-foreground md:inline">{product.name} · </span>
            {variant.name} × {selected} — <span className="font-semibold text-foreground">{formatStorePrice(variant.priceSatang * selected)}</span>
          </p>
        </div>
      </div>}
    </div>
  )
}
