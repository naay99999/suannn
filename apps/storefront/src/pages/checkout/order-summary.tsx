import { formatStorePrice } from '@/lib/store-products'
import type { CheckoutQuote } from '@/lib/store-checkout'

export function CheckoutQuoteSummary({ quote }: { quote: CheckoutQuote }) {
  return (
    <section aria-labelledby="order-summary-title" className="rounded-3xl border bg-card p-5 md:p-7">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="order-summary-title" className="text-xl font-semibold">ของในตะกร้า</h2>
        <span className="text-sm text-muted-foreground">{quote.lines.reduce((sum, line) => sum + line.quantity, 0)} ชิ้น</span>
      </div>
      <ul className="mt-6 flex flex-col gap-5">
        {quote.lines.map(line => (
          <li key={line.variantId} className="flex min-w-0 justify-between gap-4 border-b pb-5 last:border-0">
            <div className="min-w-0">
              <p className="font-medium leading-6">{line.productName ?? 'สินค้า'}{line.variantName ? ` · ${line.variantName}` : ''}</p>
              <p className="text-xs text-muted-foreground">{line.unitPriceSatang === 0 ? 'ไม่มีค่าใช้จ่าย' : `${formatStorePrice(line.unitPriceSatang)}${line.unit ? ` / ${line.unit}` : ''}`} · จำนวน {line.quantity}</p>
            </div>
            <p className="shrink-0 font-semibold tabular-nums text-primary-ink">{formatStorePrice(line.lineTotalSatang)}</p>
          </li>
        ))}
      </ul>
      <dl className="mt-2 flex flex-col gap-3 border-t pt-5 text-sm">
        <div className="flex justify-between gap-4"><dt>ยอดรวมสินค้า</dt><dd className="tabular-nums">{formatStorePrice(quote.subtotalSatang)}</dd></div>
        <div className="flex justify-between gap-4"><dt>ค่าจัดส่ง</dt><dd className="tabular-nums">{formatStorePrice(quote.shippingSatang)}</dd></div>
        <div className="flex justify-between gap-4 border-t pt-4 text-base font-semibold"><dt>ยอดชำระทั้งหมด</dt><dd className="tabular-nums text-primary-ink">{formatStorePrice(quote.totalSatang)}</dd></div>
      </dl>
      <p className="mt-4 text-xs leading-6 text-muted-foreground">ใบเสนอราคาหมดอายุ {new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(quote.expiresAt))}</p>
    </section>
  )
}

export function OrderSummary({ quote }: { quote: CheckoutQuote }) {
  return <CheckoutQuoteSummary quote={quote} />
}
