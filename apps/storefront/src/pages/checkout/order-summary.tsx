import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@workspace/ui/components/collapsible'
import { StoreProductImage } from '@/components/store-product-image'
import { formatStorePrice } from '@/lib/store-products'
import { DiscountTotalRows } from '@/components/orders/discount-total-rows'
import type { CheckoutQuote } from '@/lib/store-checkout'

export type CheckoutLineImages = ReadonlyMap<string, { src: string | null; alt: string | null }>

// Always show the first few items; longer orders reveal the rest on demand so the total stays near the top.
const previewLineCount = 3

type QuoteLine = CheckoutQuote['lines'][number]

function SummaryLine({ line, images }: { line: QuoteLine; images?: CheckoutLineImages }) {
  const image = images?.get(line.variantId)
  const name = line.productName ?? 'สินค้า'
  return (
    <li className="flex min-w-0 items-start gap-4 border-b pb-5 last:border-0 last:pb-0">
      <div className="size-16 shrink-0 overflow-hidden rounded-field">
        <StoreProductImage src={image?.src ?? null} alt={image?.alt ?? name} className="size-full object-cover" />
      </div>
      <div className="flex min-w-0 flex-1 justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-6 break-words">{name}{line.variantName ? ` · ${line.variantName}` : ''}</p>
          {line.unitPriceSatang === 0
            ? <p className="mt-1 text-xs leading-6 text-muted-foreground">ไม่มีค่าใช้จ่าย</p>
            : line.quantity > 1 && <p className="mt-1 text-xs leading-6 text-muted-foreground">{formatStorePrice(line.unitPriceSatang)}{line.unit ? ` / ${line.unit}` : ''} · จำนวน {line.quantity}</p>}
        </div>
        <p className="shrink-0 font-semibold tabular-nums text-primary-ink">{formatStorePrice(line.lineTotalSatang)}</p>
      </div>
    </li>
  )
}

export function CheckoutQuoteSummary({ quote, images }: { quote: CheckoutQuote; images?: CheckoutLineImages }) {
  const [showAll, setShowAll] = useState(false)
  const itemCount = quote.lines.reduce((sum, line) => sum + line.quantity, 0)
  const previewLines = quote.lines.slice(0, previewLineCount)
  const extraLines = quote.lines.slice(previewLineCount)

  return (
    <section aria-labelledby="order-summary-title" className="min-w-0">
      <h2 id="order-summary-title" className="text-xl font-semibold">สรุปคำสั่งซื้อ</h2>
      <p className="mt-6 text-sm font-medium">รายการสินค้า <span className="font-normal text-muted-foreground">{itemCount} ชิ้น</span></p>
      <Collapsible open={showAll} onOpenChange={setShowAll}>
        <ul className="mt-5 flex flex-col gap-5">
          {previewLines.map(line => <SummaryLine key={line.variantId} line={line} images={images} />)}
        </ul>
        {extraLines.length > 0 && <>
          <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
            <ul className="mt-5 flex flex-col gap-5 border-t pt-5">
              {extraLines.map(line => <SummaryLine key={line.variantId} line={line} images={images} />)}
            </ul>
          </CollapsibleContent>
          <CollapsibleTrigger className="group mt-4 flex w-full items-center justify-center gap-1 rounded-control py-2 text-sm font-medium text-primary-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {showAll ? 'แสดงน้อยลง' : `ดูเพิ่มเติม (อีก ${extraLines.length} รายการ)`}
            <HugeiconsIcon icon={ArrowDown01Icon} className="size-4 transition-transform duration-200 group-data-panel-open:rotate-180" aria-hidden="true" />
          </CollapsibleTrigger>
        </>}
      </Collapsible>
      <dl className="mt-6 flex flex-col gap-3 border-t pt-5 text-sm">
        <div className="flex justify-between gap-4"><dt>ยอดรวมสินค้า</dt><dd className="tabular-nums">{formatStorePrice(quote.subtotalSatang)}</dd></div>
        <DiscountTotalRows discount={quote.discount ? { code: quote.discount.code, itemDiscountSatang: quote.discountSatang, shippingDiscountSatang: quote.shippingDiscountSatang } : null} shippingSatang={quote.shippingSatang} format={formatStorePrice} valueClassName="tabular-nums" />
        <div className="flex justify-between gap-4 border-t pt-4 text-base font-semibold"><dt>ยอดชำระทั้งหมด</dt><dd className="text-2xl tabular-nums text-primary-ink">{formatStorePrice(quote.totalSatang)}</dd></div>
      </dl>
    </section>
  )
}

export function OrderSummary({ quote, images }: { quote: CheckoutQuote; images?: CheckoutLineImages }) {
  return <CheckoutQuoteSummary quote={quote} images={images} />
}
