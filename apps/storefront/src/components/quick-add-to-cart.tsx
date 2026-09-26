import { Button } from '@workspace/ui/components/button'
import { useCart } from '@/components/cart/cart-context'
import { MAX_QUANTITY } from '@/lib/cart'
import type { Product } from '@/lib/catalog'

export function QuickAddToCart({ product, className }: { product: Product; className?: string }) {
  const { items, dispatch, setOpen } = useCart()
  const quantity = items.find(item => item.productId === product.id)?.quantity ?? 0
  const available = product.availability === 'in-season'
  const label = !available ? 'รอฤดูกาลถัดไป' : quantity >= MAX_QUANTITY ? 'ครบจำนวนสูงสุด' : 'เพิ่มลงตะกร้า'

  return (
    <Button
      size="lg"
      className={className}
      disabled={!available || quantity >= MAX_QUANTITY}
      aria-label={`${product.name}: ${label}`}
      onClick={() => {
        dispatch({ type: 'add', productId: product.id, quantity: 1 })
        setOpen(true)
      }}
    >
      {label}
    </Button>
  )
}
