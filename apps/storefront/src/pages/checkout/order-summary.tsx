import { Link } from 'react-router'
import { formatPrice } from '@/lib/catalog'
import { getCartSummary, type CartItem } from '@/lib/cart'

export function OrderSummary({ items }: { items: CartItem[] }) {
  const { lines, count, subtotal } = getCartSummary(items)

  return (
    <section aria-labelledby="order-summary-title" className="rounded-3xl border bg-card p-5 md:p-7">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="order-summary-title" className="text-xl font-semibold">ของในตะกร้า</h2>
        <span className="text-sm text-muted-foreground">{count} ชิ้น</span>
      </div>
      <ul className="mt-6 flex flex-col gap-5">
        {lines.map(({ product, quantity, total }) => (
          <li key={product.id} className="flex gap-4">
            <Link to={`/products/${product.id}`} className="group shrink-0 overflow-hidden rounded-xl bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <img src={product.images[0].src} alt={product.images[0].alt} width={76} height={84} className="h-21 w-19 object-cover transition-transform duration-700 ease-out group-hover:scale-105 motion-reduce:transition-none" />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <div>
                <p className="font-medium leading-6">{product.name}</p>
                <p className="text-xs text-muted-foreground">{product.unit} · จำนวน {quantity}</p>
              </div>
              <p className="font-semibold tabular-nums text-primary-ink">{formatPrice(total)}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-col gap-3 border-t pt-5 text-sm">
        <div className="flex justify-between gap-4"><span>ยอดรวมสินค้า</span><span className="tabular-nums">{formatPrice(subtotal)}</span></div>
        <div className="flex justify-between gap-4 text-muted-foreground"><span>ค่าจัดส่ง</span><span>ยังไม่คำนวณ</span></div>
        <p className="text-xs leading-6 text-muted-foreground">ราคาและรายการสินค้าเป็นตัวอย่าง ระบบยังไม่เปิดรับคำสั่งซื้อจริง</p>
      </div>
    </section>
  )
}
