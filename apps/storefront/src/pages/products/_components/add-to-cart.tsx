import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { useCart } from '@/components/cart/cart-context'
import { QuantityControl } from '@/components/cart/quantity-control'
import { MAX_QUANTITY } from '@/lib/cart'
import type { Product } from '@/lib/catalog'

export function AddToCart({ product }: { product: Product }) {
  const [quantity, setQuantity] = useState(1)
  const { items, dispatch, setOpen } = useCart()
  const remaining = MAX_QUANTITY - (items.find(item => item.productId === product.id)?.quantity ?? 0)
  const available = product.availability === 'in-season'
  const selected = Math.min(quantity, Math.max(1, remaining))
  return (
    <div className="my-6 flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {available && remaining > 0 && <QuantityControl label={product.name} quantity={selected} max={remaining} onChange={setQuantity} />}
        <Button size="lg" className="h-11 flex-1 rounded-full" disabled={!available || remaining === 0} onClick={() => {
          dispatch({ type: 'add', productId: product.id, quantity: selected })
          setOpen(true)
          setQuantity(1)
        }}>{!available ? 'รอฤดูกาลถัดไป' : remaining === 0 ? 'ครบจำนวนสูงสุดในตะกร้า' : 'เพิ่มลงตะกร้า'}</Button>
      </div>
      <p className="text-xs text-muted-foreground">ตะกร้าตัวอย่าง · สูงสุด {MAX_QUANTITY} แพ็กต่อสินค้า · ยังไม่เปิดชำระเงินจริง</p>
    </div>
  )
}
