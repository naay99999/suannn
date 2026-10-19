import { CheckmarkCircle02Icon, CircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import type { PublicationCheck } from '@/lib/catalog/forms'

export function ConfirmActionDialog({ open, title, description, confirmLabel, confirmVariant = 'default', pending = false, onOpenChange, onConfirm }: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  confirmVariant?: 'default' | 'destructive'
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={pending} onClick={() => onOpenChange(false)} type="button" variant="outline">ยกเลิก</Button>
          <Button disabled={pending} onClick={onConfirm} type="button" variant={confirmVariant}>{pending ? 'กำลังดำเนินการ...' : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function focusField(id: string) {
  const field = document.getElementById(id)
  field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  field?.focus({ preventScroll: true })
}

export function PublicationChecklist({ checks, canEdit, onAddVariant }: {
  checks: PublicationCheck[]
  canEdit: boolean
  onAddVariant?: () => void
}) {
  const done = checks.filter((check) => check.complete).length

  return (
    <section aria-labelledby="publication-checklist-title" className="flex flex-col gap-2 rounded-field border bg-muted/30 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium" id="publication-checklist-title">เงื่อนไขการเผยแพร่</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{done}/{checks.length} ครบแล้ว</span>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {checks.map(({ label, complete, fieldId }) => {
          const onFix = fieldId ? (canEdit ? () => focusField(fieldId) : undefined) : onAddVariant
          return <li className="flex items-start gap-2" key={label}>
            <HugeiconsIcon aria-hidden="true" className={complete ? 'mt-0.5 size-4 shrink-0 text-success' : 'mt-0.5 size-4 shrink-0 text-muted-foreground/60'} icon={complete ? CheckmarkCircle02Icon : CircleIcon} strokeWidth={2} />
            {!complete && onFix
              ? <button className="text-left text-foreground underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50" onClick={onFix} type="button">{label}</button>
              : <span className={complete ? 'text-muted-foreground' : undefined}>{label}</span>}
            <span className="sr-only">{complete ? 'ครบแล้ว' : 'ยังไม่ครบ'}</span>
          </li>
        })}
      </ul>
    </section>
  )
}
