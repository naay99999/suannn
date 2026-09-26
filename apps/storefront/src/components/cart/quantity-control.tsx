import { Button } from '@workspace/ui/components/button'
import { MAX_QUANTITY } from '@/lib/cart'

export function QuantityControl({ quantity, onChange, label, max = MAX_QUANTITY }: {
  quantity: number
  onChange: (quantity: number) => void
  label: string
  max?: number
}) {
  return (
    <div role="group" aria-label={`จำนวน ${label}`} className="inline-flex shrink-0 items-center rounded-full border">
      <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label={`ลดจำนวน ${label}`} disabled={quantity <= 1} onClick={() => onChange(quantity - 1)}>−</Button>
      <span className="min-w-8 text-center text-sm tabular-nums" aria-live="polite">{quantity}</span>
      <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label={`เพิ่มจำนวน ${label}`} disabled={quantity >= max} onClick={() => onChange(quantity + 1)}>+</Button>
    </div>
  )
}
