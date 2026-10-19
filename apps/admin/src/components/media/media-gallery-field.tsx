import { useState } from 'react'
import { ArrowDown01Icon, ArrowUp01Icon, Cancel01Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { type MediaImageValue, MediaPickerDialog } from './media-picker-dialog'

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

export function MediaGalleryField({ value, onChange, disabled = false, max = 12, id }: {
  value: MediaImageValue[]
  onChange: (value: MediaImageValue[]) => void
  disabled?: boolean
  max?: number
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const hasMissingAlt = value.some((image) => !image.alt?.trim())

  return (
    <div className="flex flex-col gap-3" id={id} tabIndex={-1}>
      {value.length === 0
        ? <p className="rounded-field border border-dashed bg-muted/50 p-4 text-center text-sm text-muted-foreground">ยังไม่มีรูปสินค้า</p>
        : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {value.map((image, index) => (
              <li
                className={cn('flex flex-col gap-2 rounded-surface border p-2', dragIndex === index && 'opacity-50')}
                draggable={!disabled}
                key={image.id}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(event) => { if (dragIndex !== null) event.preventDefault() }}
                onDragStart={() => setDragIndex(index)}
                onDrop={(event) => {
                  event.preventDefault()
                  if (dragIndex !== null) onChange(move(value, dragIndex, index))
                  setDragIndex(null)
                }}
              >
                <img alt={image.alt ?? ''} className="aspect-square w-full rounded-field bg-muted object-cover" draggable={false} src={image.thumbUrl} />
                <div className="flex flex-wrap items-center gap-1">
                  {index === 0 && <Badge variant="info">ภาพปก</Badge>}
                  {!image.alt?.trim() && <Badge variant="warning">ไม่มีคำอธิบาย</Badge>}
                </div>
                <div className="flex items-center justify-between gap-1">
                  <div className="flex gap-1">
                    <Button aria-label="เลื่อนขึ้น" disabled={disabled || index === 0} onClick={() => onChange(move(value, index, index - 1))} size="icon-sm" type="button" variant="outline">
                      <HugeiconsIcon aria-hidden="true" icon={ArrowUp01Icon} strokeWidth={2} />
                    </Button>
                    <Button aria-label="เลื่อนลง" disabled={disabled || index === value.length - 1} onClick={() => onChange(move(value, index, index + 1))} size="icon-sm" type="button" variant="outline">
                      <HugeiconsIcon aria-hidden="true" icon={ArrowDown01Icon} strokeWidth={2} />
                    </Button>
                  </div>
                  <Button aria-label={`ลบรูปที่ ${index + 1}`} disabled={disabled} onClick={() => onChange(value.filter((other) => other.id !== image.id))} size="icon-sm" type="button" variant="ghost">
                    <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} strokeWidth={2} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      {hasMissingAlt && <p className="text-sm text-warning-foreground" role="status">ภาพที่ไม่มีคำอธิบายจะทำให้เผยแพร่สินค้าไม่ได้</p>}
      <div className="flex items-center gap-3">
        <Button disabled={disabled || value.length >= max} onClick={() => setOpen(true)} type="button" variant="outline">
          <HugeiconsIcon data-icon="inline-start" icon={PlusSignIcon} strokeWidth={2} />
          เลือกรูปภาพ
        </Button>
        <span className="text-sm text-muted-foreground">{value.length}/{max} รูป รูปแรกเป็นภาพปก</span>
      </div>
      <MediaPickerDialog
        maxSelectable={max}
        mode="multiple"
        onConfirm={onChange}
        onOpenChange={setOpen}
        open={open}
        selectedIds={value.map((image) => image.id)}
        selectedValues={value}
      />
    </div>
  )
}
