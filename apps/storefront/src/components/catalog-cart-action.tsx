import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ShoppingBag01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@workspace/ui/components/button'
import { useCart } from './cart/cart-context'
import { QuantityControl } from './cart/quantity-control'
import { MAX_QUANTITY } from '@/lib/cart'
import { storeCartQueryKey } from '@/lib/store-cart'
import { getStoreProduct, storeProductDetailQueryKey, type StoreProductSummary } from '@/lib/store-products'

export function CatalogCartAction({ product }: { product: StoreProductSummary }) {
  const queryClient = useQueryClient()
  const { cart, pending, setItem, removeItem } = useCart()
  const [selected, setSelected] = useState<{ id: string; name: string; unit: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const line = cart?.lines.find(item => item.productId === product.id && (!selected || item.variantId === selected.id))
  const quantity = line?.quantity ?? 0
  const disabled = busy || pending || !cart
  const available = product.canPurchase && (!line || (line.canPurchase && !line.issues.length))
  const variantName = line?.variantName ?? selected?.name
  const unit = line?.unit ?? selected?.unit

  async function changeQuantity(next: number) {
    if (locked.current || disabled || next < 0 || next > MAX_QUANTITY || (next > quantity && !available)) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      let variant = line ? { id: line.variantId, name: line.variantName ?? 'ตัวเลือกสินค้า', unit: line.unit ?? '' } : null
      if (!variant) {
        const detail = await queryClient.fetchQuery({ queryKey: storeProductDetailQueryKey(product.slug), queryFn: () => getStoreProduct(product.slug), staleTime: 30_000 }).catch(() => {
          throw new Error('โหลดตัวเลือกสินค้าไม่ได้ กรุณาลองอีกครั้ง')
        })
        variant = detail.canPurchase ? detail.variants.filter(item => item.canPurchase).toSorted((a, b) => a.priceSatang - b.priceSatang).find(item => !selected || item.id === selected.id) ?? null : null
        if (!variant) throw new Error('สินค้ารายการนี้ยังไม่พร้อมสั่งซื้อ')
      }
      setSelected(variant)
      if (next === 0) await removeItem(variant.id)
      else await setItem(variant.id, next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'อัปเดตตะกร้าไม่ได้ กรุณาลองอีกครั้ง')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  return <div className="mt-3 flex flex-col gap-2" aria-busy={busy}>
    {quantity > 0 ? <QuantityControl label={product.name} quantity={quantity} min={0} max={available ? MAX_QUANTITY : quantity} disabled={disabled}
      className="w-full justify-between rounded-md [&_button]:size-11 [&_button]:rounded-md" onChange={next => { void changeQuantity(next) }} />
      : !cart && !pending ? <Button variant="outline" className="min-h-11 w-full px-2" onClick={() => { void queryClient.refetchQueries({ queryKey: storeCartQueryKey }) }}>ลองโหลดตะกร้าใหม่</Button>
        : <Button className="min-h-11 w-full gap-1 px-2 text-sm" disabled={disabled || !available} aria-label={`เพิ่ม ${product.name} ลงตะกร้า`} onClick={() => { void changeQuantity(1) }}>
          <HugeiconsIcon icon={ShoppingBag01Icon} data-icon="inline-start" />
          {busy ? 'กำลังเพิ่ม...' : available ? 'เพิ่มลงตะกร้า' : 'ยังไม่พร้อมสั่งซื้อ'}
        </Button>}
    <p className="min-h-4 text-xs leading-4 text-muted-foreground">{variantName ? `${variantName}${unit ? ` · ${unit}` : ''}` : null}</p>
    {error && <p role="alert" className="text-xs leading-5 text-destructive">{error}</p>}
  </div>
}
