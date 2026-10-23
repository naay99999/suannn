import { cn } from '@workspace/ui/lib/utils'

export interface DiscountTotals {
  code: string
  itemDiscountSatang: number
  shippingDiscountSatang: number
}

interface DiscountTotalRowsProps {
  discount: DiscountTotals | null | undefined
  // The shipping fee actually charged, after any free-shipping discount.
  shippingSatang: number
  format: (satang: number) => string
  freeLabel?: string
  labelClassName?: string
  valueClassName?: string
}

// The discount and shipping rows of an order or quote total, shared by checkout and every order page.
export function DiscountTotalRows({ discount, shippingSatang, format, freeLabel = 'ฟรี', labelClassName, valueClassName }: DiscountTotalRowsProps) {
  const itemDiscount = discount?.itemDiscountSatang ?? 0
  const shippingDiscount = discount?.shippingDiscountSatang ?? 0
  return (
    <>
      {discount && itemDiscount > 0 && (
        <div className="flex justify-between gap-4"><dt className={labelClassName}>ส่วนลด ({discount.code})</dt><dd className={cn('text-success', valueClassName)}>−{format(itemDiscount)}</dd></div>
      )}
      <div className="flex justify-between gap-4">
        <dt className={labelClassName}>{discount && shippingDiscount > 0 && itemDiscount === 0 ? `ค่าจัดส่ง (ส่งฟรี ${discount.code})` : 'ค่าจัดส่ง'}</dt>
        <dd className={cn('flex gap-2', valueClassName)}>
          {shippingDiscount > 0 && <s className="text-muted-foreground"><span className="sr-only">ราคาเดิม </span>{format(shippingSatang + shippingDiscount)}</s>}
          <span>{shippingSatang === 0 ? freeLabel : format(shippingSatang)}</span>
        </dd>
      </div>
    </>
  )
}
