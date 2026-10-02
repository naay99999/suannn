import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Textarea } from '@workspace/ui/components/textarea'
import type { Lot, QuarantineInput, WriteOffInput, CountAdjustmentInput } from '@/lib/inventory/api'
import {
  countAdjustmentSchema,
  quarantineSchema,
  toCountAdjustmentInput,
  toQuarantineInput,
  toWriteOffInput,
  writeOffSchema,
  type CountAdjustmentValues,
  type QuarantineValues,
  type WriteOffValues,
} from '@/lib/inventory/forms'

export type LotCommandKind = 'quarantine' | 'release' | 'write-off' | 'count-adjustment'
export type LotCommandSubmission =
  | { kind: 'quarantine'; input: QuarantineInput }
  | { kind: 'release' }
  | { kind: 'write-off'; input: WriteOffInput }
  | { kind: 'count-adjustment'; input: CountAdjustmentInput }

export function LotCommandDialog({
  open,
  kind,
  lot,
  isPending,
  error,
  uncertain,
  onOpenChange,
  onDirtyChange,
  onSubmit,
  onRetry,
}: {
  open: boolean
  kind: LotCommandKind
  lot: Lot
  isPending: boolean
  error: string | null
  uncertain: boolean
  onOpenChange: (open: boolean) => void
  onDirtyChange: (dirty: boolean) => void
  onSubmit: (submission: LotCommandSubmission) => Promise<Lot | undefined>
  onRetry: () => Promise<Lot | undefined>
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const quarantineForm = useForm<QuarantineValues>({
    resolver: zodResolver(quarantineSchema),
    defaultValues: { reason: '' },
  })
  const writeOffForm = useForm<WriteOffValues>({
    resolver: zodResolver(writeOffSchema),
    defaultValues: { quantity: 0, reason: '' as WriteOffValues['reason'], note: '' },
  })
  const countForm = useForm<CountAdjustmentValues>({
    resolver: zodResolver(countAdjustmentSchema),
    defaultValues: { countedQuantity: 0, reason: '' },
  })
  const formDirty = kind === 'quarantine'
    ? quarantineForm.formState.isDirty
    : kind === 'write-off'
      ? writeOffForm.formState.isDirty
      : kind === 'count-adjustment'
        ? countForm.formState.isDirty
        : false

  useEffect(() => {
    onDirtyChange(formDirty)
  }, [formDirty, onDirtyChange])

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const copy = useMemo(() => ({
    quarantine: {
      title: 'กักกันล็อตสินค้า',
      description: 'การกักกันจะยกเลิกการจองที่ใช้ล็อตนี้ ตรวจสอบผลกระทบก่อนยืนยัน',
      confirm: 'ยืนยันกักกันล็อต',
    },
    release: {
      title: 'นำล็อตออกจากการกักกัน',
      description: 'ล็อตที่หมดอายุยังคงขายไม่ได้ แม้นำออกจากการกักกันแล้ว',
      confirm: 'ยืนยันนำออกจากการกักกัน',
    },
    'write-off': {
      title: 'ตัดสต็อกที่สูญเสีย',
      description: 'การตัดสต็อกจะลดจำนวนของจริงในล็อตนี้',
      confirm: 'ยืนยันตัดสต็อก',
    },
    'count-adjustment': {
      title: 'ปรับยอดจากการนับจริง',
      description: 'กรอกยอดคงเหลือจริงทั้งหมด ระบบจะตั้งจำนวนล็อตเป็นยอดนี้ ไม่ได้นำไปบวกกับยอดเดิม',
      confirm: 'ยืนยันปรับยอด',
    },
  }), [])

  function requestClose() {
    if (isPending || uncertain) {
      onOpenChange(false)
      return
    }
    if (formDirty) {
      setConfirmDiscard(true)
      return
    }
    onOpenChange(false)
  }

  async function submitQuarantine(values: QuarantineValues) {
    const result = await onSubmit({ kind: 'quarantine', input: toQuarantineInput(values) })
    if (result) {
      quarantineForm.reset(values)
      onDirtyChange(false)
      onOpenChange(false)
    }
  }

  async function submitWriteOff(values: WriteOffValues) {
    const result = await onSubmit({ kind: 'write-off', input: toWriteOffInput(values) })
    if (result) {
      writeOffForm.reset(values)
      onDirtyChange(false)
      onOpenChange(false)
    }
  }

  async function submitCount(values: CountAdjustmentValues) {
    const result = await onSubmit({ kind: 'count-adjustment', input: toCountAdjustmentInput(values) })
    if (result) {
      countForm.reset(values)
      onDirtyChange(false)
      onOpenChange(false)
    }
  }

  async function confirmRelease() {
    const result = await onSubmit({ kind: 'release' })
    if (result) onOpenChange(false)
  }

  async function retry() {
    const result = await onRetry()
    if (result) {
      quarantineForm.reset()
      writeOffForm.reset()
      countForm.reset()
      onDirtyChange(false)
      onOpenChange(false)
    }
  }

  const heading = copy[kind]
  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && requestClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{heading.title}</DialogTitle>
            <DialogDescription>{heading.description}</DialogDescription>
          </DialogHeader>
          {uncertain
            ? <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p aria-live="assertive" className="text-sm" role="alert">ยังไม่ได้รับคำยืนยันจากเซิร์ฟเวอร์ คำสั่งนี้อาจดำเนินการแล้ว การส่งซ้ำจะใช้ข้อมูลและรหัสคำขอเดิม</p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={isPending} onClick={() => void retry()} type="button">{isPending ? 'กำลังส่งคำขอเดิม...' : 'ส่งคำขอเดิมซ้ำ'}</Button>
                <Button disabled={isPending} onClick={requestClose} type="button" variant="outline">ปิดหน้าต่าง</Button>
              </div>
            </div>
            : <>
              {kind === 'quarantine' && <form className="flex flex-col gap-5" noValidate onSubmit={quarantineForm.handleSubmit(submitQuarantine)}>
                <FieldGroup>
                  <Field data-invalid={Boolean(quarantineForm.formState.errors.reason)}>
                    <FieldLabel htmlFor="quarantine-reason">เหตุผลกักกัน</FieldLabel>
                    <Textarea aria-describedby={quarantineForm.formState.errors.reason ? 'quarantine-reason-error' : undefined} aria-invalid={Boolean(quarantineForm.formState.errors.reason)} disabled={isPending} id="quarantine-reason" maxLength={200} {...quarantineForm.register('reason')} />
                    <FieldError id="quarantine-reason-error">{quarantineForm.formState.errors.reason?.message}</FieldError>
                  </Field>
                  <FieldDescription>ผู้ซื้อจะไม่สามารถจองสินค้าจากล็อตนี้ และระบบจะยกเลิกการจองที่ใช้อยู่</FieldDescription>
                </FieldGroup>
                <CommandError error={error} />
                <DialogFooter>
                  <Button disabled={isPending} onClick={requestClose} type="button" variant="outline">ปิดหน้าต่าง</Button>
                  <Button disabled={isPending} type="submit">{isPending ? 'กำลังดำเนินการ...' : heading.confirm}</Button>
                </DialogFooter>
              </form>}
              {kind === 'release' && <div className="flex flex-col gap-4">
                <p className="rounded-md bg-muted/50 p-3 text-sm">ยืนยันนำล็อต {lot.lotCode} ออกจากการกักกัน หากล็อตหมดอายุหรือมีสถานะขัดแย้ง เซิร์ฟเวอร์จะปฏิเสธและข้อมูลจะโหลดใหม่</p>
                <CommandError error={error} />
                <DialogFooter>
                  <Button disabled={isPending} onClick={requestClose} type="button" variant="outline">ยกเลิก</Button>
                  <Button disabled={isPending} onClick={() => void confirmRelease()} type="button">{isPending ? 'กำลังดำเนินการ...' : heading.confirm}</Button>
                </DialogFooter>
              </div>}
              {kind === 'write-off' && <form className="flex flex-col gap-5" noValidate onSubmit={writeOffForm.handleSubmit(submitWriteOff)}>
                <FieldGroup>
                  <FormInput
                    error={writeOffForm.formState.errors.quantity?.message}
                    id="write-off-quantity"
                    label="จำนวนที่ตัดออก"
                    max={1_000_000_000}
                    min={1}
                    type="number"
                    {...writeOffForm.register('quantity', { valueAsNumber: true })}
                    disabled={isPending}
                  />
                  <Field data-invalid={Boolean(writeOffForm.formState.errors.reason)}>
                    <FieldLabel htmlFor="write-off-reason">เหตุผลการตัดสต็อก</FieldLabel>
                    <Controller control={writeOffForm.control} name="reason" render={({ field }) => (
                      <Select disabled={isPending} onValueChange={field.onChange} value={field.value || ''}>
                        <SelectTrigger aria-describedby={writeOffForm.formState.errors.reason ? 'write-off-reason-error' : undefined} aria-invalid={Boolean(writeOffForm.formState.errors.reason)} aria-required="true" id="write-off-reason">
                          <SelectValue placeholder="เลือกเหตุผล" />
                        </SelectTrigger>
                        <SelectContent><SelectGroup>
                          <SelectItem value="spoiled">เน่าเสีย</SelectItem>
                          <SelectItem value="expired">หมดอายุ</SelectItem>
                          <SelectItem value="damaged">ชำรุด</SelectItem>
                        </SelectGroup></SelectContent>
                      </Select>
                    )} />
                    <FieldError id="write-off-reason-error">{writeOffForm.formState.errors.reason?.message}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(writeOffForm.formState.errors.note)}>
                    <FieldLabel htmlFor="write-off-note">หมายเหตุ (ไม่บังคับ)</FieldLabel>
                    <Textarea aria-describedby={writeOffForm.formState.errors.note ? 'write-off-note-error' : undefined} aria-invalid={Boolean(writeOffForm.formState.errors.note)} disabled={isPending} id="write-off-note" maxLength={200} {...writeOffForm.register('note')} />
                    <FieldError id="write-off-note-error">{writeOffForm.formState.errors.note?.message}</FieldError>
                  </Field>
                  <p className="rounded-md bg-muted/50 p-3 text-sm">ตัดสต็อก {writeOffForm.watch('quantity') || '—'} หน่วยจากล็อต {lot.lotCode}</p>
                </FieldGroup>
                <CommandError error={error} />
                <DialogFooter>
                  <Button disabled={isPending} onClick={requestClose} type="button" variant="outline">ยกเลิก</Button>
                  <Button disabled={isPending} type="submit">{isPending ? 'กำลังดำเนินการ...' : heading.confirm}</Button>
                </DialogFooter>
              </form>}
              {kind === 'count-adjustment' && <form className="flex flex-col gap-5" noValidate onSubmit={countForm.handleSubmit(submitCount)}>
                <FieldGroup>
                  <FormInput
                    error={countForm.formState.errors.countedQuantity?.message}
                    id="counted-quantity"
                    label="จำนวนที่นับได้จริง"
                    max={1_000_000_000}
                    min={0}
                    type="number"
                    {...countForm.register('countedQuantity', { valueAsNumber: true })}
                    disabled={isPending}
                  />
                  <Field data-invalid={Boolean(countForm.formState.errors.reason)}>
                    <FieldLabel htmlFor="count-adjustment-reason">รหัสเหตุผล</FieldLabel>
                    <Input aria-describedby={countForm.formState.errors.reason ? 'count-adjustment-reason-error' : 'count-adjustment-reason-help'} aria-invalid={Boolean(countForm.formState.errors.reason)} disabled={isPending} id="count-adjustment-reason" maxLength={100} {...countForm.register('reason')} />
                    <FieldDescription id="count-adjustment-reason-help">เริ่มด้วยตัวอักษรอังกฤษตัวพิมพ์เล็ก ตามด้วยตัวพิมพ์เล็ก ตัวเลข จุด ขีด หรือขีดล่าง</FieldDescription>
                    <FieldError id="count-adjustment-reason-error">{countForm.formState.errors.reason?.message}</FieldError>
                  </Field>
                  <p className="rounded-md bg-muted/50 p-3 text-sm">ตั้งยอดคงเหลือจริงใหม่เป็น {countForm.watch('countedQuantity') ?? '—'} หน่วย (ปัจจุบัน {lot.onHandQuantity})</p>
                </FieldGroup>
                <CommandError error={error} />
                <DialogFooter>
                  <Button disabled={isPending} onClick={requestClose} type="button" variant="outline">ยกเลิก</Button>
                  <Button disabled={isPending} type="submit">{isPending ? 'กำลังดำเนินการ...' : heading.confirm}</Button>
                </DialogFooter>
              </form>}
              {isPending && <p aria-live="polite" className="text-sm text-muted-foreground" role="status">กำลังส่งคำสั่ง สามารถปิดหน้าต่างได้โดยคำสั่งจะยังทำงานต่อ</p>}
            </>}
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ทิ้งข้อมูลคำสั่งนี้?</DialogTitle>
            <DialogDescription>ข้อมูลที่กรอกในหน้าต่างนี้จะหายไป</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmDiscard(false)} type="button" variant="outline">กลับไปแก้ไข</Button>
            <Button onClick={() => {
              quarantineForm.reset()
              writeOffForm.reset()
              countForm.reset()
              onDirtyChange(false)
              setConfirmDiscard(false)
              onOpenChange(false)
            }} type="button" variant="destructive">ทิ้งข้อมูล</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function CommandError({ error }: { error: string | null }) {
  return error ? <p aria-live="assertive" className="text-sm text-destructive" role="alert">{error}</p> : null
}

function FormInput({ id, label, error, ...props }: {
  id: string
  label: string
  error?: string
} & React.ComponentProps<typeof Input>) {
  const errorId = `${id}-error`
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} id={id} {...props} />
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  )
}
