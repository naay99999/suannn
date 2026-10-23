import { useId, useState, type FormEvent } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tag01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import type { CartDiscount } from '@/lib/store-cart'
import { discountErrorText, discountStatusText, useApplyDiscount, useRemoveDiscount } from '@/lib/store-discount'

export function DiscountCodeField({ discount }: { discount: CartDiscount | null }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const inputId = useId()
  const apply = useApplyDiscount()
  const remove = useRemoveDiscount()

  if (discount) {
    const problem = discount.status === 'not_applicable'
    return (
      <div className="flex items-start justify-between gap-3 text-sm">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium"><HugeiconsIcon icon={Tag01Icon} className="size-4 shrink-0" aria-hidden="true" /><span className="break-all">{discount.code}</span></p>
          <p role="status" className={problem ? 'mt-1 text-xs text-destructive' : 'mt-1 text-xs text-muted-foreground'}>{discountStatusText(discount)}</p>
          {remove.isError && <p role="alert" className="mt-1 text-xs text-destructive">ลบโค้ดไม่ได้ กรุณาลองอีกครั้ง</p>}
        </div>
        <Button type="button" variant="ghost" size="sm" aria-label={`ลบโค้ด ${discount.code}`} disabled={remove.isPending} onClick={() => remove.mutate()}>ลบโค้ด</Button>
      </div>
    )
  }

  if (!open) {
    return <Button type="button" variant="link" className="self-start px-0" onClick={() => setOpen(true)}>มีโค้ดส่วนลด?</Button>
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = code.trim()
    if (!trimmed || apply.isPending) return
    apply.mutate(trimmed, { onSuccess: () => setCode('') })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <Field data-invalid={apply.isError}>
        <FieldLabel htmlFor={inputId}>โค้ดส่วนลด</FieldLabel>
        <div className="flex gap-2">
          <Input id={inputId} value={code} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} aria-invalid={apply.isError} onChange={event => { setCode(event.target.value); if (apply.isError) apply.reset() }} />
          <Button type="submit" variant="outline" disabled={apply.isPending || !code.trim()}>ใช้โค้ด</Button>
        </div>
        {apply.isError && <FieldError>{discountErrorText(apply.error)}</FieldError>}
      </Field>
    </form>
  )
}
