import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { toast } from '@workspace/ui/components/toast'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { QueryState } from '@/components/query-state'
import { ProductVariantPicker, type VariantSelection } from '@/components/product-variant-picker'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'
import { useInventoryCommand } from '@/hooks/use-inventory-command'
import { apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { hasPermission } from '@/lib/permissions'
import { inventoryApi, type Lot, type ReceiveInput } from '@/lib/inventory/api'
import { receiveLotSchema, toReceiveInput, type ReceiveLotValues } from '@/lib/inventory/forms'
import { warehouseQuery } from '@/lib/inventory/queries'
import { cn } from '@workspace/ui/lib/utils'

function bangkokToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function Component() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const session = useQuery(authSessionQuery)
  const warehouse = useQuery(warehouseQuery())
  const [selection, setSelection] = useState<VariantSelection | null>(null)
  const [selectionTouched, setSelectionTouched] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const form = useForm<ReceiveLotValues>({
    resolver: zodResolver(receiveLotSchema),
    defaultValues: {
      lotCode: '',
      quantity: 1,
      expiryDate: '',
      receivedAt: '',
      quarantined: false,
      quarantineReason: '',
    },
  })
  const command = useInventoryCommand<ReceiveInput, Lot>({
    command: 'inventory.receive-lot',
    execute: (input, key) => inventoryApi.receive(input, key),
  })
  const canAdjust = hasPermission(session.data, 'inventory:adjust')
  const unsavedConfirmation = useUnsavedChanges(
    form.formState.isDirty || selectionTouched || command.isPending || command.uncertain,
  )
  const expired = Boolean(form.watch('expiryDate') && form.watch('expiryDate') < bangkokToday())

  if (warehouse.isPending || session.isPending) return <section className="px-4 lg:px-6"><QueryState kind="loading" /></section>
  if (warehouse.error) return <section className="px-4 lg:px-6"><QueryState kind="error" message={apiErrorMessage(warehouse.error)} onRetry={() => void warehouse.refetch()} /></section>
  if (session.error) return <section className="px-4 lg:px-6"><QueryState kind="error" message="ไม่สามารถตรวจสอบสิทธิ์ได้ กรุณาลองอีกครั้ง" onRetry={() => void session.refetch()} /></section>

  const receivedAt = form.watch('receivedAt')
  const quarantineEnabled = form.watch('quarantined')

  function updateSelection(next: VariantSelection | null) {
    setSelection(next)
    setSelectionTouched(true)
    setSelectionError(null)
  }

  function canSubmit() {
    const currentSession = queryClient.getQueryData(authSessionQuery.queryKey)
    const currentWarehouse = queryClient.getQueryData(warehouseQuery().queryKey)
    if (!hasPermission(currentSession, 'inventory:adjust')) {
      setSelectionError('คุณไม่มีสิทธิ์ปรับสต็อก กรุณาตรวจสอบสิทธิ์อีกครั้ง')
      return false
    }
    if (!currentWarehouse || currentWarehouse.code !== 'MAIN' || !currentWarehouse.isActive) {
      setSelectionError('คลังหลักไม่พร้อมรับสินค้า กรุณาโหลดข้อมูลคลังใหม่')
      void warehouse.refetch()
      return false
    }
    if (!selection) {
      setSelectionError('กรุณาเลือกสินค้าและรูปแบบสินค้าก่อนรับเข้า')
      return false
    }
    if (selection.variant.archivedAt) {
      setSelectionError('รูปแบบสินค้านี้ถูกเก็บแล้ว กรุณาเลือกแบบที่ใช้งานอยู่')
      return false
    }
    return true
  }

  async function submit(values: ReceiveLotValues) {
    setSelectionError(null)
    if (!canSubmit()) return
    const input = toReceiveInput(values, warehouse.data!.id, selection!.variant.id)
    const result = await command.submit(input)
    if (result) finishReceipt(result)
  }

  async function retry() {
    setSelectionError(null)
    const currentSession = queryClient.getQueryData(authSessionQuery.queryKey)
    if (!hasPermission(currentSession, 'inventory:adjust')) {
      setSelectionError('คุณไม่มีสิทธิ์ปรับสต็อก กรุณาตรวจสอบสิทธิ์อีกครั้ง')
      return
    }
    // A retry must replay the original resolved warehouse and variant payload;
    // checking their current state could strand an uncertain receipt.
    const result = await command.retry()
    if (result) finishReceipt(result)
  }

  function finishReceipt(result: Lot) {
    form.reset()
    setSelection(null)
    setSelectionTouched(false)
    toast.add({ title: 'รับสินค้าเข้าสต็อกแล้ว', type: 'success' })
    navigate(`/inventory/lots/${result.id}`)
  }

  const formErrors = form.formState.errors
  const showExpiredWarning = expired && !command.uncertain
  if (!canAdjust) return <section className="flex flex-col gap-4 px-4 lg:px-6">
    <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/inventory">กลับไปหน้าสต็อก</Link>
    <QueryState kind="forbidden" message="คุณไม่มีสิทธิ์รับหรือปรับสต็อก" />
  </section>

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-3">
        <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/inventory">กลับไปหน้าสต็อก</Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">รับสินค้าเข้าคลัง</h1>
          <p className="text-sm text-muted-foreground">คลังหลัก · {warehouse.data.name} ({warehouse.data.code})</p>
        </div>
      </div>
      <ProductVariantPicker disabled={command.isPending || command.uncertain} onChange={updateSelection} value={selection} />
      <form className="flex flex-col gap-5 rounded-lg border p-4" noValidate onSubmit={form.handleSubmit(submit)}>
        <FieldGroup>
          {selection && <p className="rounded-md bg-muted/50 p-3 text-sm">รับเข้า {selection.productName} · {selection.variant.sku} · {selection.variant.name} ({selection.variant.unit})</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput error={formErrors.lotCode?.message} id="receive-lot-code" label="รหัสล็อต" disabled={command.isPending || command.uncertain} maxLength={102} {...form.register('lotCode')} required />
            <FormInput error={formErrors.quantity?.message} id="receive-quantity" label="จำนวนที่รับเข้า" disabled={command.isPending || command.uncertain} max={1_000_000_000} min={1} type="number" {...form.register('quantity', { valueAsNumber: true })} required />
            <FormInput error={formErrors.expiryDate?.message} id="receive-expiry-date" label="วันหมดอายุ" disabled={command.isPending || command.uncertain} type="date" {...form.register('expiryDate')} required />
            <FormInput error={formErrors.receivedAt?.message} id="receive-received-at" label="วันและเวลาที่รับเข้า (ไม่บังคับ)" disabled={command.isPending || command.uncertain} type="datetime-local" {...form.register('receivedAt')} />
          </div>
          <Field data-invalid={Boolean(formErrors.quarantined || formErrors.quarantineReason)}>
            <FieldLabel htmlFor="receive-quarantined">
              <Controller control={form.control} name="quarantined" render={({ field }) => (
                <Checkbox checked={field.value} disabled={command.isPending || command.uncertain} id="receive-quarantined" onCheckedChange={(checked) => field.onChange(checked === true)} />
              )} />
              รับเข้าโดยกักกันล็อตนี้
            </FieldLabel>
            <FieldDescription>ใช้เมื่อจำเป็นต้องตรวจสอบคุณภาพก่อนอนุญาตให้จองสินค้า</FieldDescription>
          </Field>
          {quarantineEnabled && <FormInput error={formErrors.quarantineReason?.message} id="receive-quarantine-reason" label="เหตุผลกักกัน" disabled={command.isPending || command.uncertain} maxLength={200} {...form.register('quarantineReason')} required />}
        </FieldGroup>
        {showExpiredWarning && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">วันหมดอายุที่เลือกผ่านไปแล้ว ระบบอาจรับล็อตนี้ได้ตามกฎของเซิร์ฟเวอร์ โปรดตรวจสอบข้อมูลก่อนยืนยัน</p>}
        {receivedAt && <p className="text-sm text-muted-foreground">เวลารับเข้าจะตีความเป็นเวลาไทย (Asia/Bangkok)</p>}
        {selectionError && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{selectionError}</p>}
        {command.error && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{command.error}</p>}
        {command.uncertain && <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p aria-live="assertive" className="text-sm" role="alert">ยังไม่ได้รับคำยืนยันจากเซิร์ฟเวอร์ คำรับเข้าอาจดำเนินการแล้ว การส่งซ้ำจะใช้ข้อมูลและรหัสคำขอเดิม</p>
          <Button disabled={command.isPending} onClick={() => void retry()} type="button">{command.isPending ? 'กำลังส่งคำขอเดิม...' : 'ส่งคำขอเดิมซ้ำ'}</Button>
        </div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Link className={cn(buttonVariants({ variant: 'outline' }))} to="/inventory">ยกเลิก</Link>
          <Button disabled={command.isPending || command.uncertain || !warehouse.data.isActive} type="submit">{command.isPending ? 'กำลังรับสินค้า...' : 'ยืนยันรับสินค้าเข้าคลัง'}</Button>
        </div>
      </form>
      {unsavedConfirmation}
    </section>
  )
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
