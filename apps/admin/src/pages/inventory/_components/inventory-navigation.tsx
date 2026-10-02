import { Link } from 'react-router'
import { buttonVariants } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

export function InventoryNavigation({ variantId, lotId, productId }: { variantId?: string; lotId?: string; productId?: string }) {
  const movementParams = new URLSearchParams()
  if (variantId) movementParams.set('variantId', variantId)
  if (lotId) movementParams.set('lotId', lotId)
  if (productId) movementParams.set('productId', productId)
  const movementHref = movementParams.size ? `/inventory/movements?${movementParams}` : '/inventory/movements'
  return (
    <nav aria-label="นำทางคลังสินค้า" className="flex flex-wrap gap-2">
      <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} to="/inventory">รายการล็อต</Link>
      <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} to={movementHref}>ประวัติความเคลื่อนไหว</Link>
      {variantId && <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} to={`/inventory/variants/${variantId}${productId ? `?productId=${productId}` : ''}`}>สต็อกรูปแบบสินค้า</Link>}
      {lotId && <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} to={`/inventory/lots/${lotId}`}>รายละเอียดล็อต</Link>}
    </nav>
  )
}
