import { Link } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { FieldError } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { CopyableId } from './copyable-id'

export type ReservationLineDisplay = {
  variantId: string
  quantity: number
  label?: string
  productId?: string
  lotId?: string
}

type ReservationLinesProps = {
  lines: ReservationLineDisplay[]
  disabled?: boolean
  quantityErrors?: Record<string, string | undefined>
  onQuantityChange?: (variantId: string, quantity: number) => void
  onRemove?: (variantId: string) => void
}

export function ReservationLines({ lines, disabled = false, quantityErrors, onQuantityChange, onRemove }: ReservationLinesProps) {
  const editable = Boolean(onQuantityChange)
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{editable ? 'รายการรูปแบบสินค้าที่จะจอง' : 'รายการล็อตที่จัดสรรให้การจอง'}</caption>
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 font-medium" scope="col">รูปแบบสินค้า</th>
            {!editable && <th className="px-3 py-2 font-medium" scope="col">ล็อตที่จัดสรร</th>}
            <th className="px-3 py-2 font-medium" scope="col">จำนวน</th>
            {editable && <th className="px-3 py-2 font-medium" scope="col"><span className="sr-only">จัดการรายการ</span></th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const quantityError = quantityErrors?.[line.variantId]
            const quantityErrorId = `reservation-quantity-${line.variantId}-error`
            return (
              <tr className="border-t" key={`${line.variantId}:${line.lotId ?? 'new'}`}>
                <td className="min-w-56 px-3 py-3 align-top">
                  <div className="flex flex-col gap-1">
                    {line.label && <span className="font-medium">{line.label}</span>}
                    <CopyableId label="รหัสรูปแบบสินค้า" value={line.variantId} />
                    {line.productId && <Link className="text-primary underline-offset-4 hover:underline" to={`/products/${line.productId}`}>ดูสินค้า</Link>}
                  </div>
                </td>
                {!editable && <td className="min-w-56 px-3 py-3 align-top">
                  {line.lotId
                    ? <div className="flex flex-col gap-1">
                      <Link className="w-fit text-primary underline-offset-4 hover:underline" to={`/inventory/lots/${line.lotId}`}>เปิดรายละเอียดล็อต</Link>
                      <CopyableId label="รหัสล็อต" value={line.lotId} />
                    </div>
                    : <span className="text-muted-foreground">ยังไม่มีรหัสล็อต</span>}
                </td>}
                <td className="px-3 py-3 align-top">
                  {editable
                    ? <div className="flex flex-col gap-1">
                      <Input
                        aria-label={`จำนวน ${line.label ?? line.variantId}`}
                        aria-describedby={quantityError ? quantityErrorId : undefined}
                        aria-invalid={Boolean(quantityError)}
                        disabled={disabled}
                        max={1_000_000}
                        min={1}
                        onChange={(event) => onQuantityChange?.(line.variantId, event.target.value === '' ? 0 : Number(event.target.value))}
                        type="number"
                        value={line.quantity}
                      />
                      <FieldError id={quantityErrorId}>{quantityError}</FieldError>
                    </div>
                    : <span className="tabular-nums">{line.quantity}</span>}
                </td>
                {editable && <td className="px-3 py-3 text-right align-top">
                  <Button disabled={disabled} onClick={() => onRemove?.(line.variantId)} type="button" variant="outline">นำออก</Button>
                </td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
