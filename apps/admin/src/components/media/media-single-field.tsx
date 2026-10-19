import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldDescription, FieldLabel } from '@workspace/ui/components/field'
import { type MediaImageValue, MediaPickerDialog } from './media-picker-dialog'

export function MediaSingleField({ label, value, onChange, disabled = false, description }: {
  label: string
  value: MediaImageValue | null
  onChange: (value: MediaImageValue | null) => void
  disabled?: boolean
  description?: string
}) {
  const [open, setOpen] = useState(false)
  const noAlt = value !== null && !value.alt?.trim()

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-3">
        {value
          ? <img alt={value.alt ?? ''} className="size-24 shrink-0 rounded-field border bg-muted object-cover" src={value.thumbUrl} />
          : <div className="grid size-24 shrink-0 place-items-center rounded-field border border-dashed bg-muted/50 p-2 text-center text-xs text-muted-foreground">ยังไม่มีรูป</div>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={disabled} onClick={() => setOpen(true)} type="button" variant="outline">
            {value ? `เปลี่ยน${label}` : `เลือก${label}`}
          </Button>
          {value && <Button disabled={disabled} onClick={() => onChange(null)} type="button" variant="ghost">{`ลบ${label}`}</Button>}
        </div>
      </div>
      {noAlt && <FieldDescription className="text-warning-foreground">รูปนี้ยังไม่มีคำอธิบายภาพ จะเผยแพร่ฟาร์มไม่ได้</FieldDescription>}
      {description && <FieldDescription>{description}</FieldDescription>}
      <MediaPickerDialog
        mode="single"
        onConfirm={(items) => onChange(items[0] ?? null)}
        onOpenChange={setOpen}
        open={open}
        selectedIds={value ? [value.id] : []}
        selectedValues={value ? [value] : []}
      />
    </Field>
  )
}
