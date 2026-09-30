import { Link } from 'react-router'
import { formatStorePrice } from '@/lib/store-products'
import { getCartSummary } from '@/lib/cart'
import type { StoreCartDetail } from '@/lib/store-cart'
import { StoreProductImage } from '@/components/store-product-image'

export function OrderSummary({ cart }: { cart: StoreCartDetail }) {
  const { lines, count, subtotalSatang, hasUnavailable } = getCartSummary(cart)

  return (
    <section aria-labelledby="order-summary-title" className="rounded-3xl border bg-card p-5 md:p-7">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="order-summary-title" className="text-xl font-semibold">ของในตะกร้า</h2>
        <span className="text-sm text-muted-foreground">{count} ชิ้น</span>
      </div>
      <ul className="mt-6 flex flex-col gap-5">
        {lines.map(line => (
          <li key={line.variantId} className="flex gap-4">
            {line.productSlug
              ? <Link to={`/products/${line.productSlug}`} className="group size-19 shrink-0 overflow-hidden rounded-xl bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><StoreProductImage src={line.productImageUrl} alt={line.productImageAlt ?? line.productName ?? 'สินค้า'} className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 motion-reduce:transition-none" /></Link>
              : <div className="size-19 shrink-0 overflow-hidden rounded-xl bg-muted"><StoreProductImage src={line.productImageUrl} alt={line.productImageAlt ?? line.productName ?? 'สินค้า'} className="size-full object-cover" /></div>}
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <div>
                <p className="font-medium leading-6">{line.productName ?? 'สินค้า'}</p>
                <p className="text-xs text-muted-foreground">{line.variantName ?? 'ตัวเลือกสินค้า'}{line.unit ? ` · ${line.unit}` : ''} · จำนวน {line.quantity}</p>
              </div>
              <p className="font-semibold tabular-nums text-primary-ink">{line.totalSatang === null ? 'ราคายังไม่พร้อม' : formatStorePrice(line.totalSatang)}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-col gap-3 border-t pt-5 text-sm">
        <div className="flex justify-between gap-4"><span>ยอดรวมสินค้า</span><span className="tabular-nums">{formatStorePrice(subtotalSatang)}</span></div>
        <div className="flex justify-between gap-4 text-muted-foreground"><span>ค่าจัดส่ง</span><span>คำนวณในขั้นตอน checkout</span></div>
        {hasUnavailable && <p role="alert" className="text-xs leading-6 text-destructive">มีสินค้าไม่พร้อมสั่งซื้อ โปรดแก้ไขตะกร้าก่อนยืนยัน</p>}
      </div>
    </section>
  )
}
