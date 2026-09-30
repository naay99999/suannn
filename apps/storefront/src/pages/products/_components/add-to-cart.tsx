import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { useCart } from '@/components/cart/cart-context'
import { QuantityControl } from '@/components/cart/quantity-control'
import { MAX_QUANTITY } from '@/lib/cart'
import type { StoreProductDetail } from '@/lib/store-products'

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
      <div className="flex flex-wrap gap-3">
        {available && remaining > 0 && <QuantityControl label={product.name} quantity={selected} max={remaining} onChange={setQuantity} />}
        <Button size="lg" className="h-11 flex-1 rounded-full" disabled={!available || remaining === 0 || pending} onClick={() => { void add() }}>
          {!available ? 'ยังไม่พร้อมสั่งซื้อ' : remaining === 0 ? 'ครบจำนวนสูงสุดในตะกร้า' : 'เพิ่มลงตะกร้า'}
        </Button>
      </div>
      {remaining > 0 && available && <p className="text-xs text-muted-foreground">เลือกจำนวนที่ต้องการได้ สูงสุด {MAX_QUANTITY} ชิ้นต่อรายการ</p>}
    </div>
  )
}
