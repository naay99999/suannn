import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { toast } from '@workspace/ui/components/toast'
import { Badge } from '@workspace/ui/components/badge'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { cn } from '@workspace/ui/lib/utils'
import { QueryState } from '@/components/query-state'
import { useInventoryCommand } from '@/hooks/use-inventory-command'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { formatTimestamp } from '@/lib/format'
import { hasPermission } from '@/lib/permissions'
import { inventoryApi, type Reservation } from '@/lib/inventory/api'
import { reservationLookupSchema } from '@/lib/inventory/forms'
import { inventoryKeys, reservationQuery, scheduleReservationExpiry } from '@/lib/inventory/queries'
import { cachedVariantMetadata, variantLabel } from './_components/variant-metadata'
import { CopyableId } from './_components/copyable-id'
import { InventoryNavigation } from './_components/inventory-navigation'
import { ReservationLines } from './_components/reservation-lines'

const statusLabels: Record<Reservation['status'], string> = {
  active: 'กำลังจอง',
  confirmed: 'ยืนยันแล้ว',
  released: 'ปล่อยการจองแล้ว',
  expired: 'หมดอายุ',
  cancelled: 'ถูกยกเลิก',
}

function reservationError(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 404) return { kind: 'not-found' as const, message: 'ไม่พบการจองนี้' }
  if (error instanceof ApiRequestError && error.status === 403) return { kind: 'forbidden' as const, message: 'ไม่มีสิทธิ์อ่านการจองนี้' }
  return { kind: 'error' as const, message: apiErrorMessage(error) }
}

export function Component() {
  const { reservationId } = useParams()
  const validId = reservationLookupSchema.safeParse({ reservationId }).success
  if (!reservationId || !validId) return <section className="flex flex-col gap-4 px-4 lg:px-6">
    <QueryState kind="not-found" message="รหัสการจองไม่ถูกต้อง" />
    <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/inventory/reservations">กลับไปค้นหาการจอง</Link>
  </section>
  return <ReservationDetail key={reservationId} reservationId={reservationId} />
}

function ReservationDetail({ reservationId }: { reservationId: string }) {
  const queryClient = useQueryClient()
  const reservationQueryResult = useQuery(reservationQuery(reservationId))
  const refetchReservation = reservationQueryResult.refetch
  const session = useQuery(authSessionQuery)
  const [locallyExpired, setLocallyExpired] = useState(false)
  const [confirmation, setConfirmation] = useState<'confirm' | 'release' | null>(null)
  const [actionError, setActionError] = useState('')
  const canAdjust = hasPermission(session.data, 'inventory:adjust')
  const confirmCommand = useInventoryCommand<Record<string, never>, Reservation>({
    command: 'inventory.confirm-reservation',
    execute: (_input, key) => inventoryApi.confirmReservation(reservationId, key),
  })
  const releaseCommand = useInventoryCommand<Record<string, never>, Reservation>({
    command: 'inventory.release-reservation',
    execute: (_input, key) => inventoryApi.releaseReservation(reservationId, key),
  })
  const outstandingKind = confirmCommand.uncertain || confirmCommand.isPending
    ? 'confirm'
    : releaseCommand.uncertain || releaseCommand.isPending
      ? 'release'
      : null
  const outstandingCommand = outstandingKind === 'confirm' ? confirmCommand : releaseCommand
  const hasUnresolvedCommand = confirmCommand.isPending || confirmCommand.uncertain || releaseCommand.isPending || releaseCommand.uncertain
  const reservation = reservationQueryResult.data
  const expiredLocally = locallyExpired
  const unsavedConfirmation = useUnsavedChanges(
    hasUnresolvedCommand,
    'ผลคำสั่งยังไม่ทราบแน่ชัด หากออกจากหน้านี้จะสูญเสียรหัสคำขอเดิมและส่งซ้ำจากหน้านี้ไม่ได้',
  )

  const activeExpiry = reservation?.status === 'active' ? reservation.expiresAt : null
  useEffect(() => {
    if (!activeExpiry) return
    return scheduleReservationExpiry(activeExpiry, () => {
      setLocallyExpired(true)
      void refetchReservation()
    })
  }, [activeExpiry, refetchReservation])

  if (session.isPending || reservationQueryResult.isPending) return <section className="px-4 lg:px-6"><QueryState kind="loading" /></section>
  if (session.error) return <section className="px-4 lg:px-6"><QueryState kind="error" message="ไม่สามารถตรวจสอบสิทธิ์ได้ กรุณาลองอีกครั้ง" onRetry={() => void session.refetch()} /></section>
  if (reservationQueryResult.error || !reservation) {
    const state = reservationError(reservationQueryResult.error)
    return <section className="flex flex-col gap-4 px-4 lg:px-6">
      <QueryState kind={state.kind} message={state.message} onRetry={state.kind === 'error' ? () => void reservationQueryResult.refetch() : undefined} />
      <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/inventory/reservations">กลับไปค้นหาการจอง</Link>
    </section>
  }

  const active = reservation.status === 'active'
  const canSubmitAction = canAdjust && active && !expiredLocally && !hasUnresolvedCommand
  const allocationLines = reservation.allocations.map((allocation) => {
    const metadata = cachedVariantMetadata(queryClient, allocation.variantId)
    return {
      variantId: allocation.variantId,
      lotId: allocation.lotId,
      quantity: allocation.quantity,
      productId: metadata?.product.id,
      label: variantLabel(metadata),
    }
  })
  const error = actionError || confirmCommand.error || releaseCommand.error

  function checkCommandPermissionAndState(): boolean {
    const currentSession = queryClient.getQueryData(authSessionQuery.queryKey)
    if (!hasPermission(currentSession, 'inventory:adjust')) {
      setActionError('คุณไม่มีสิทธิ์จัดการการจอง กรุณาตรวจสอบสิทธิ์อีกครั้ง')
      return false
    }
    const currentReservation = queryClient.getQueryData<Reservation>(inventoryKeys.reservation(reservationId))
    if (!currentReservation) {
      setActionError('กำลังโหลดสถานะการจองล่าสุด กรุณาลองอีกครั้ง')
      void reservationQueryResult.refetch()
      return false
    }
    if (currentReservation.status !== 'active' || Date.now() >= Date.parse(currentReservation.expiresAt) || locallyExpired) {
      setActionError('สถานะการจองอาจเปลี่ยนแล้ว กรุณาตรวจสอบข้อมูลล่าสุดก่อนดำเนินการ')
      void reservationQueryResult.refetch()
      return false
    }
    return true
  }

  function requestConfirmation(kind: 'confirm' | 'release') {
    setActionError('')
    if (!checkCommandPermissionAndState()) return
    setConfirmation(kind)
  }

  async function submitCommand() {
    const kind = confirmation
    if (!kind || !checkCommandPermissionAndState()) return
    const result = kind === 'confirm'
      ? await confirmCommand.submit({})
      : await releaseCommand.submit({})
    setConfirmation(null)
    if (result) toast.add({ title: kind === 'confirm' ? 'ยืนยันและตัดสต็อกแล้ว' : 'ปล่อยการจองแล้ว', type: 'success' })
  }

  async function retryCommand() {
    setActionError('')
    const currentSession = queryClient.getQueryData(authSessionQuery.queryKey)
    if (!hasPermission(currentSession, 'inventory:adjust')) {
      setActionError('คุณไม่มีสิทธิ์จัดการการจอง กรุณาตรวจสอบสิทธิ์อีกครั้ง')
      return
    }
    const result = await outstandingCommand.retry()
    if (result) toast.add({ title: outstandingKind === 'confirm' ? 'ยืนยันและตัดสต็อกแล้ว' : 'ปล่อยการจองแล้ว', type: 'success' })
  }

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-3">
        <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/inventory/reservations">กลับไปค้นหาการจอง</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">รายละเอียดการจอง</h1>
          <Badge variant={reservation.status === 'active' ? 'secondary' : reservation.status === 'expired' || reservation.status === 'cancelled' ? 'destructive' : 'outline'}>{statusLabels[reservation.status]}</Badge>
        </div>
        <InventoryNavigation />
      </div>
      <section aria-label="ข้อมูลการจอง" className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <dl className="flex flex-col gap-1">
          <dt className="text-sm font-medium">รหัสการจอง</dt>
          <dd><CopyableId label="รหัสการจอง" value={reservation.id} /></dd>
        </dl>
        <dl className="flex flex-col gap-1">
          <dt className="text-sm font-medium">รหัสอ้างอิงภายนอก</dt>
          <dd className="break-all text-sm">{reservation.externalReference || 'ไม่มี'}</dd>
        </dl>
        <dl className="flex flex-col gap-1">
          <dt className="text-sm font-medium">หมดเวลาจอง</dt>
          <dd className="text-sm">{formatTimestamp(reservation.expiresAt)}</dd>
        </dl>
        <dl className="flex flex-col gap-1">
          <dt className="text-sm font-medium">คลังสินค้า</dt>
          <dd className="text-sm">{reservation.warehouseId}</dd>
        </dl>
      </section>
      {active && expiredLocally && <p aria-live="polite" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">ถึงเวลาหมดอายุตามข้อมูลเซิร์ฟเวอร์แล้ว กำลังตรวจสอบสถานะล่าสุดและปิดคำสั่งชั่วคราว</p>}
      {!canAdjust && <p className="text-sm text-muted-foreground" role="status">คุณมีสิทธิ์ดูข้อมูล แต่ไม่มีสิทธิ์ยืนยันหรือปล่อยการจอง</p>}
      {canAdjust && active && <div className="flex flex-wrap gap-2">
        <Button disabled={!canSubmitAction} onClick={() => requestConfirmation('confirm')} type="button">ยืนยันและตัดสต็อก</Button>
        <Button disabled={!canSubmitAction} onClick={() => requestConfirmation('release')} type="button" variant="outline">ปล่อยการจอง</Button>
      </div>}
      {canAdjust && hasUnresolvedCommand && outstandingKind && <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <p className="text-sm" role="status">คำสั่งอาจดำเนินการบนเซิร์ฟเวอร์แล้ว การส่งซ้ำจะใช้คำสั่งและรหัสคำขอเดิม</p>
        {outstandingCommand.uncertain && <Button disabled={outstandingCommand.isPending} onClick={() => void retryCommand()} type="button">{outstandingCommand.isPending ? 'กำลังส่งคำขอเดิม...' : outstandingKind === 'confirm' ? 'ส่งคำยืนยันเดิมซ้ำ' : 'ส่งคำขอปล่อยเดิมซ้ำ'}</Button>}
      </div>}
      {error && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{error}</p>}
      <section aria-label="รายการล็อตที่จัดสรร" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">ล็อตที่ระบบจัดสรร</h2>
          <p className="text-sm text-muted-foreground">ระบบเลือกล็อตให้แบบ FIFO การจัดสรรนี้มาจากเซิร์ฟเวอร์</p>
        </div>
        {allocationLines.length > 0
          ? <ReservationLines lines={allocationLines} />
          : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">การจองนี้ไม่มีล็อตที่จัดสรร</p>}
      </section>
      <Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open && !hasUnresolvedCommand) setConfirmation(null) }}>
        <DialogContent showCloseButton={!confirmCommand.isPending && !releaseCommand.isPending}>
          <DialogHeader>
            <DialogTitle>{confirmation === 'confirm' ? 'ยืนยันการใช้สต็อกที่จองไว้?' : 'ปล่อยการจองนี้?'}</DialogTitle>
            <DialogDescription>
              {confirmation === 'confirm'
                ? 'การยืนยันจะตัดจำนวนที่ถือไว้จากสต็อกจริงและสร้างประวัติการเคลื่อนไหว'
                : 'การปล่อยจะคืนจำนวนที่ถือไว้ให้สต็อกที่จองได้'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={confirmCommand.isPending || releaseCommand.isPending} onClick={() => setConfirmation(null)} type="button" variant="outline">กลับไปตรวจสอบ</Button>
            <Button disabled={confirmCommand.isPending || releaseCommand.isPending || expiredLocally} onClick={() => void submitCommand()} type="button" variant={confirmation === 'confirm' ? 'destructive' : 'default'}>
              {confirmation === 'confirm' ? 'ยืนยันการตัดสต็อก' : 'ยืนยันปล่อยการจอง'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {unsavedConfirmation}
    </section>
  )
}
