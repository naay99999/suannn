import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { toast } from '@workspace/ui/components/toast'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { cn } from '@workspace/ui/lib/utils'
import { QueryState } from '@/components/query-state'
import { ProductVariantPicker, type VariantSelection } from '@/components/product-variant-picker'
import { useInventoryCommand } from '@/hooks/use-inventory-command'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'
import { apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { hasPermission } from '@/lib/permissions'
import { inventoryApi, type Reservation, type ReserveInput } from '@/lib/inventory/api'
import { reservationSchema, toReserveInput, type ReservationValues } from '@/lib/inventory/forms'
import { warehouseQuery } from '@/lib/inventory/queries'
import { ReservationLines, type ReservationLineDisplay } from './_components/reservation-lines'

export function Component() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const session = useQuery(authSessionQuery)
  const warehouse = useQuery(warehouseQuery())
  const [selection, setSelection] = useState<VariantSelection | null>(null)
  const [selectionError, setSelectionError] = useState('')
  const [redirectReservationId, setRedirectReservationId] = useState('')
  const [lineMetadata, setLineMetadata] = useState<Record<string, Pick<ReservationLineDisplay, 'label' | 'productId'>>>({})
  const form = useForm<ReservationValues>({
    resolver: zodResolver(reservationSchema),
    defaultValues: { lines: [], externalReference: '' },
  })
  const command = useInventoryCommand<ReserveInput, Reservation>({
    command: 'inventory.reserve',
    execute: (input, key) => inventoryApi.reserve(input, key),
  })
  const canAdjust = hasPermission(session.data, 'inventory:adjust')
  const lines = form.watch('lines')
  const unsavedConfirmation = useUnsavedChanges(
    !redirectReservationId && (form.formState.isDirty || selection !== null || command.isPending || command.uncertain),
    command.isPending || command.uncertain
      ? 'การจองอาจดำเนินการบนเซิร์ฟเวอร์แล้ว หากออกจากหน้านี้จะสูญเสียรหัสคำขอเดิมและส่งซ้ำจากหน้านี้ไม่ได้'
      : undefined,
  )

  useEffect(() => {
    if (redirectReservationId) navigate(`/inventory/reservations/${redirectReservationId}`)
  }, [navigate, redirectReservationId])

  if (session.isPending || warehouse.isPending) return <section className="px-4 lg:px-6"><QueryState kind="loading" /></section>
  if (session.error) return <section className="px-4 lg:px-6"><QueryState kind="error" message="ไม่สามารถตรวจสอบสิทธิ์ได้ กรุณาลองอีกครั้ง" onRetry={() => void session.refetch()} /></section>
  if (warehouse.error) return <section className="px-4 lg:px-6"><QueryState kind="error" message={apiErrorMessage(warehouse.error)} onRetry={() => void warehouse.refetch()} /></section>
  if (!canAdjust) return <section className="flex flex-col gap-4 px-4 lg:px-6">
    <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/inventory/reservations">กลับไปค้นหาการจอง</Link>
    <QueryState kind="forbidden" message="คุณไม่มีสิทธิ์สร้างการจองสินค้า" />
  </section>

  const displayedLines: ReservationLineDisplay[] = lines.map((line) => ({
    ...line,
    ...lineMetadata[line.variantId],
  }))
  const linesError = form.formState.errors.lines?.message
  const quantityErrors = Object.fromEntries(lines.flatMap((line, index) => {
    const message = form.formState.errors.lines?.[index]?.quantity?.message
    return message ? [[line.variantId, message]] : []
  }))
  const canUseMainWarehouse = warehouse.data.code === 'MAIN' && warehouse.data.isActive

  function addSelection() {
    if (!selection) {
      setSelectionError('กรุณาเลือกสินค้าและรูปแบบสินค้าก่อนเพิ่มรายการ')
      return
    }
    const currentLines = form.getValues('lines')
    if (currentLines.some((line) => line.variantId === selection.variant.id)) {
      setSelectionError('รูปแบบสินค้านี้อยู่ในรายการแล้ว')
      return
    }
    if (currentLines.length >= 50) {
      setSelectionError('เพิ่มรูปแบบสินค้าได้ไม่เกิน 50 รายการ')
      return
    }
    form.setValue('lines', [...currentLines, { variantId: selection.variant.id, quantity: 1 }], { shouldDirty: true, shouldValidate: true })
    setLineMetadata((current) => ({
      ...current,
      [selection.variant.id]: {
        label: `${selection.productName} · ${selection.variant.sku} · ${selection.variant.name}`,
        productId: selection.productId,
      },
    }))
    setSelection(null)
    setSelectionError('')
  }

  function changeQuantity(variantId: string, quantity: number) {
    const currentLines = form.getValues('lines')
    form.setValue('lines', currentLines.map((line) => line.variantId === variantId ? { ...line, quantity } : line), { shouldDirty: true, shouldValidate: true })
  }

  function removeLine(variantId: string) {
    form.setValue('lines', form.getValues('lines').filter((line) => line.variantId !== variantId), { shouldDirty: true, shouldValidate: true })
    setLineMetadata((current) => {
      const next = { ...current }
      delete next[variantId]
      return next
    })
  }

  async function finishReservation(result: Reservation) {
    form.reset({ lines: [], externalReference: '' })
    setLineMetadata({})
    setSelection(null)
    toast.add({ title: 'สร้างการจองแล้ว', type: 'success' })
    setRedirectReservationId(result.id)
  }

  async function submit(values: ReservationValues) {
    setSelectionError('')
    const currentSession = queryClient.getQueryData(authSessionQuery.queryKey)
    const currentWarehouse = queryClient.getQueryData(warehouseQuery().queryKey)
    if (!hasPermission(currentSession, 'inventory:adjust')) {
      setSelectionError('คุณไม่มีสิทธิ์สร้างการจอง กรุณาตรวจสอบสิทธิ์อีกครั้ง')
      return
    }
    if (!currentWarehouse || currentWarehouse.code !== 'MAIN' || !currentWarehouse.isActive) {
      setSelectionError('คลังหลักไม่พร้อมใช้งาน กรุณาโหลดข้อมูลคลังใหม่')
      void warehouse.refetch()
      return
    }
    const result = await command.submit(toReserveInput(values, currentWarehouse.id))
    if (result) await finishReservation(result)
  }

  async function retry() {
    setSelectionError('')
    const currentSession = queryClient.getQueryData(authSessionQuery.queryKey)
    if (!hasPermission(currentSession, 'inventory:adjust')) {
      setSelectionError('คุณไม่มีสิทธิ์สร้างการจอง กรุณาตรวจสอบสิทธิ์อีกครั้ง')
      return
    }
    const result = await command.retry()
    if (result) await finishReservation(result)
  }

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-3">
        <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/inventory/reservations">กลับไปค้นหาการจอง</Link>
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">สร้างการจองสินค้า</h1>
          <p className="text-sm text-muted-foreground">คลังหลัก · {warehouse.data.name} ({warehouse.data.code})</p>
          <p className="text-sm text-muted-foreground">ระบบเลือกล็อตแบบ FIFO และสร้างการจองหลายรายการพร้อมกันภายในรายการเดียว ระยะเวลาถือสินค้า 15 นาที</p>
        </div>
      </div>
      <ProductVariantPicker disabled={command.isPending || command.uncertain} onChange={(next) => { setSelection(next); setSelectionError('') }} value={selection} />
      <Button disabled={!selection || command.isPending || command.uncertain || lines.length >= 50} onClick={addSelection} type="button" variant="outline">เพิ่มรูปแบบที่เลือก</Button>
      {selectionError && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{selectionError}</p>}
      {displayedLines.length > 0 && <section aria-label="รายการสินค้าที่จะจอง" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">รายการสินค้าที่จะจอง</h2>
        <ReservationLines
          disabled={command.isPending || command.uncertain}
          lines={displayedLines}
          quantityErrors={quantityErrors}
          onQuantityChange={changeQuantity}
          onRemove={removeLine}
        />
      </section>}
      <form className="flex flex-col gap-5 rounded-lg border p-4" noValidate onSubmit={form.handleSubmit(submit)}>
        <FieldGroup>
          <Field aria-describedby={linesError ? 'reservation-lines-error' : 'reservation-lines-help'} data-invalid={Boolean(linesError)}>
            <p className="text-sm font-medium">รูปแบบสินค้าในรายการ</p>
            <FieldDescription id="reservation-lines-help">เพิ่ม 1 ถึง 50 รูปแบบสินค้าที่ไม่ซ้ำกัน</FieldDescription>
            {lines.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีรูปแบบสินค้าในรายการ</p>}
            <FieldError id="reservation-lines-error">{linesError}</FieldError>
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.externalReference)}>
            <FieldLabel htmlFor="reservation-external-reference">รหัสอ้างอิงภายนอก (ไม่บังคับ)</FieldLabel>
            <Input
              aria-describedby={form.formState.errors.externalReference ? 'reservation-reference-error' : undefined}
              aria-invalid={Boolean(form.formState.errors.externalReference)}
              disabled={command.isPending || command.uncertain}
              id="reservation-external-reference"
              maxLength={255}
              {...form.register('externalReference')}
            />
            <FieldError id="reservation-reference-error">{form.formState.errors.externalReference?.message}</FieldError>
          </Field>
        </FieldGroup>
        {command.error && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{command.error}</p>}
        {command.uncertain && <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p aria-live="assertive" className="text-sm" role="alert">ยังไม่ได้รับคำยืนยันจากเซิร์ฟเวอร์ การจองอาจดำเนินการแล้ว การส่งซ้ำจะใช้รายการและรหัสคำขอเดิม</p>
          <Button disabled={command.isPending} onClick={() => void retry()} type="button">{command.isPending ? 'กำลังส่งคำขอเดิม...' : 'ส่งคำขอเดิมซ้ำ'}</Button>
        </div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Link className={cn(buttonVariants({ variant: 'outline' }))} to="/inventory/reservations">ยกเลิก</Link>
          <Button disabled={command.isPending || command.uncertain || !canUseMainWarehouse} type="submit">
            {command.isPending ? 'กำลังสร้างการจอง...' : 'สร้างการจอง'}
          </Button>
        </div>
      </form>
      {unsavedConfirmation}
    </section>
  )
}
