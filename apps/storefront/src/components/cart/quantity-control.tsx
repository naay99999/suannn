import { Button } from '@workspace/ui/components/button'
import { MAX_QUANTITY } from '@/lib/cart'
import { cn } from '@workspace/ui/lib/utils'

export function QuantityControl({ quantity, onChange, label, min = 1, max = MAX_QUANTITY, disabled = false, className }: {
  quantity: number
  onChange: (quantity: number) => void
  label: string
  max?: number
  min?: number
  disabled?: boolean
  className?: string
}) {
  return (
    <div role="group" aria-label={`จำนวน ${label}`} className={cn('inline-flex shrink-0 items-center rounded-full border', className)}>
      <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label={`ลดจำนวน ${label}`} disabled={disabled || quantity <= min} onClick={() => onChange(quantity - 1)}>−</Button>
      <span className="min-w-8 text-center text-sm tabular-nums" aria-live="polite">{quantity}</span>
      <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label={`เพิ่มจำนวน ${label}`} disabled={disabled || quantity >= max} onClick={() => onChange(quantity + 1)}>+</Button>
    </div>
  )
}
