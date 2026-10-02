import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { toast } from '@workspace/ui/components/toast'
import { Badge } from '@workspace/ui/components/badge'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { QueryState } from '@/components/query-state'
import { useCursorPagination } from '@/hooks/use-cursor-pagination'
import { useInventoryCommand } from '@/hooks/use-inventory-command'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { hasPermission } from '@/lib/permissions'
import { formatDateOnly, formatTimestamp } from '@/lib/format'
import { inventoryApi, type CountAdjustmentInput, type Lot, type QuarantineInput, type WriteOffInput } from '@/lib/inventory/api'
import { lotQuery, movementsQuery } from '@/lib/inventory/queries'
import { cn } from '@workspace/ui/lib/utils'
import { CopyableId } from './_components/copyable-id'
import { InventoryNavigation } from './_components/inventory-navigation'
import { MovementTable } from './_components/movement-table'
import { LotCommandDialog, type LotCommandKind, type LotCommandSubmission } from './_components/lot-command-dialog'

function lotErrorState(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 404) return { kind: 'not-found' as const, message: 'ไม่พบล็อตสินค้านี้' }
  if (error instanceof ApiRequestError && error.status === 403) return { kind: 'forbidden' as const, message: 'ไม่มีสิทธิ์เข้าถึงล็อตนี้' }
  return { kind: 'error' as const, message: apiErrorMessage(error) }
}

function bangkokToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Bangkok' }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function Component() {
  const { lotId } = useParams()
  return <LotDetailPage key={lotId ?? 'missing'} lotId={lotId} />
}

function LotDetailPage({ lotId }: { lotId: string | undefined }) {
  const queryClient = useQueryClient()
  const { cursor, limit, canPrevious, next, previous, first, setLimit } = useCursorPagination([])
  const lot = useQuery({ ...lotQuery(lotId ?? ''), enabled: Boolean(lotId) })
  const movements = useQuery({
    ...movementsQuery({ lotId, limit, cursor }),
    enabled: Boolean(lot.data),
  })
  const session = useQuery(authSessionQuery)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogKind, setDialogKind] = useState<LotCommandKind>('quarantine')
  const [dialogDirty, setDialogDirty] = useState(false)
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const quarantineCommand = useInventoryCommand<QuarantineInput, Lot>({
    command: 'inventory.quarantine-lot',
    execute: (input, key) => inventoryApi.quarantine(lotId ?? '', input, key),
  })
  const releaseCommand = useInventoryCommand<Record<string, never>, Lot>({
    command: 'inventory.release-quarantine',
    execute: (_input, key) => inventoryApi.releaseQuarantine(lotId ?? '', key),
  })
  const writeOffCommand = useInventoryCommand<WriteOffInput, Lot>({
    command: 'inventory.write-off',
    execute: (input, key) => inventoryApi.writeOff(lotId ?? '', input, key),
  })
  const countCommand = useInventoryCommand<CountAdjustmentInput, Lot>({
    command: 'inventory.adjust-count',
    execute: (input, key) => inventoryApi.adjustCount(lotId ?? '', input, key),
  })
  const commandByKind = {
    quarantine: quarantineCommand,
    release: releaseCommand,
    'write-off': writeOffCommand,
    'count-adjustment': countCommand,
  }
  const currentCommand = commandByKind[dialogKind]
  const outstandingKind = (Object.keys(commandByKind) as LotCommandKind[]).find((kind) => {
    const command = commandByKind[kind]
    return command.isPending || command.uncertain
  })
  const hasOutstandingCommand = Boolean(outstandingKind)
  const hasUnresolvedCommand = Object.values(commandByKind).some((command) => command.isPending || command.uncertain)
  const canAdjust = hasPermission(session.data, 'inventory:adjust')
  const unsavedConfirmation = useUnsavedChanges(
    dialogDirty || hasUnresolvedCommand,
    hasUnresolvedCommand
      ? 'มีคำสั่งที่ยังไม่ได้รับผลยืนยัน ซึ่งอาจดำเนินการบนเซิร์ฟเวอร์แล้ว หากออกจากหน้านี้จะสูญเสียรหัสคำขอเดิมและส่งซ้ำจากหน้านี้ไม่ได้'
      : undefined,
  )

  if (!lotId) return <section className="px-4 lg:px-6"><QueryState kind="not-found" message="ไม่พบรหัสล็อต" /></section>
  if (lot.isPending) return <section className="px-4 lg:px-6"><QueryState kind="loading" /></section>
  if (lot.error) {
    const state = lotErrorState(lot.error)
    return <section className="flex flex-col gap-4 px-4 lg:px-6">
      <QueryState kind={state.kind} message={state.message} onRetry={state.kind === 'error' ? () => void lot.refetch() : undefined} />
      <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/inventory">กลับไปหน้าสต็อก</Link>
    </section>
  }

  const expired = lot.data.expiryDate < bangkokToday()
  const availableQuantity = lot.data.onHandQuantity - lot.data.reservedQuantity

  function openCommand(kind: LotCommandKind) {
    setDialogKind(kind)
    setPreflightError(null)
    setDialogOpen(true)
  }

  function preflight(kind: LotCommandKind, input?: LotCommandSubmission): boolean {
    const currentSession = queryClient.getQueryData(authSessionQuery.queryKey)
    if (!hasPermission(currentSession, 'inventory:adjust')) {
      setPreflightError('คุณไม่มีสิทธิ์ปรับสต็อก กรุณาตรวจสอบสิทธิ์อีกครั้ง')
      return false
    }
    const currentLot = queryClient.getQueryData(lotQuery(lotId ?? '').queryKey)
    if (!currentLot) {
      setPreflightError('กำลังโหลดข้อมูลล็อตล่าสุด กรุณาลองอีกครั้ง')
      void lot.refetch()
      return false
    }

    let message: string | null = null
    if (kind === 'quarantine' && currentLot.quarantinedAt) message = 'ล็อตนี้ถูกกักกันแล้ว กรุณาตรวจสอบข้อมูลล่าสุด'
    if (kind === 'release') {
      if (!currentLot.quarantinedAt) message = 'ล็อตนี้ไม่ได้อยู่ในสถานะกักกันแล้ว กรุณาตรวจสอบข้อมูลล่าสุด'
      else if (currentLot.expiryDate < bangkokToday()) message = 'ล็อตหมดอายุแล้ว จึงนำออกจากการกักกันไม่ได้'
      else if (currentLot.reservedQuantity !== 0) message = 'ล็อตยังมีการจอง กรุณาตรวจสอบข้อมูลล่าสุดก่อนนำออกจากการกักกัน'
    }
    if (kind === 'write-off' && input?.kind === 'write-off' && input.input.quantity > currentLot.onHandQuantity - currentLot.reservedQuantity) {
      message = 'จำนวนที่ตัดออกมากกว่าจำนวนที่ไม่ได้จอง กรุณาตรวจสอบสต็อกล่าสุด'
    }
    if (kind === 'count-adjustment' && input?.kind === 'count-adjustment' && input.input.countedQuantity < currentLot.reservedQuantity) {
      message = 'ยอดนับจริงต่ำกว่ายอดที่จองไว้ กรุณาตรวจสอบสต็อกล่าสุด'
    }
    if (message) {
      setPreflightError(message)
      void lot.refetch()
      return false
    }
    return true
  }

  async function submitCommand(submission: LotCommandSubmission): Promise<Lot | undefined> {
    setPreflightError(null)
    if (!preflight(submission.kind, submission)) return undefined
    let result: Lot | undefined
    switch (submission.kind) {
      case 'quarantine':
        result = await quarantineCommand.submit(submission.input)
        break
      case 'release':
        result = await releaseCommand.submit({})
        break
      case 'write-off':
        result = await writeOffCommand.submit(submission.input)
        break
      case 'count-adjustment':
        result = await countCommand.submit(submission.input)
        break
    }
    if (result) toast.add({ title: 'บันทึกการปรับสต็อกแล้ว', type: 'success' })
    return result
  }

  async function retryCommand(): Promise<Lot | undefined> {
    setPreflightError(null)
    const currentSession = queryClient.getQueryData(authSessionQuery.queryKey)
    if (!hasPermission(currentSession, 'inventory:adjust')) {
      setPreflightError('คุณไม่มีสิทธิ์ปรับสต็อก กรุณาตรวจสอบสิทธิ์อีกครั้ง')
      return undefined
    }
    // A retry is the same logical command with its saved payload and key. Recheck permission, but let the server replay it even if the lot state now reflects the first attempt.
    const result = await commandByKind[dialogKind].retry()
    if (result) toast.add({ title: 'บันทึกการปรับสต็อกแล้ว', type: 'success' })
    return result
  }

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-3">
        <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/inventory">กลับไปหน้าสต็อก</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">ล็อต {lot.data.lotCode}</h1>
          {lot.data.quarantinedAt && <Badge variant="destructive">กักกัน</Badge>}
          {expired && <Badge variant="secondary">หมดอายุ</Badge>}
          {lot.data.onHandQuantity === 0 && <Badge variant="outline">หมดแล้ว</Badge>}
        </div>
        <InventoryNavigation lotId={lot.data.id} variantId={lot.data.variantId} />
        {canAdjust && hasOutstandingCommand && outstandingKind && <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm" role="status">มีคำสั่งสต็อกที่ยังไม่มีผลลัพธ์ยืนยัน เก็บรหัสคำขอไว้ชั่วคราวจนกว่าจะส่งซ้ำหรือได้รับผล</p>
          <Button onClick={() => openCommand(outstandingKind)} type="button" variant="outline">เปิดคำสั่งเดิม</Button>
        </div>}
        {canAdjust && !hasOutstandingCommand && <div className="flex flex-wrap gap-2">
          {!lot.data.quarantinedAt && <Button onClick={() => openCommand('quarantine')} type="button" variant="outline">กักกันล็อต</Button>}
          {lot.data.quarantinedAt && <Button onClick={() => openCommand('release')} type="button" variant="outline">นำล็อตออกจากการกักกัน</Button>}
          {availableQuantity > 0 && <Button onClick={() => openCommand('write-off')} type="button" variant="outline">ตัดสต็อก</Button>}
          <Button onClick={() => openCommand('count-adjustment')} type="button" variant="outline">ปรับยอดนับ</Button>
        </div>}
        {session.data && !canAdjust && <p className="text-sm text-muted-foreground" role="status">คุณมีสิทธิ์ดูข้อมูล แต่ไม่มีสิทธิ์ปรับสต็อก</p>}
      </div>
      <section className="grid gap-6 rounded-lg border p-4 md:grid-cols-2">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1"><dt className="font-medium">รหัสรูปแบบสินค้า</dt><dd><CopyableId label="รหัสรูปแบบสินค้า" value={lot.data.variantId} /></dd></div>
          <div className="flex flex-col gap-1"><dt className="font-medium">วันรับเข้า</dt><dd>{formatTimestamp(lot.data.receivedAt)}</dd></div>
          <div className="flex flex-col gap-1"><dt className="font-medium">วันหมดอายุ</dt><dd>{formatDateOnly(lot.data.expiryDate)}</dd></div>
          <div className="flex flex-col gap-1"><dt className="font-medium">คลังสินค้า</dt><dd>{lot.data.warehouseId}</dd></div>
        </dl>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-muted/50 p-3"><dt className="text-sm text-muted-foreground">คงเหลือจริง</dt><dd className="text-xl font-semibold tabular-nums">{lot.data.onHandQuantity}</dd></div>
          <div className="rounded-md bg-muted/50 p-3"><dt className="text-sm text-muted-foreground">ถูกจอง</dt><dd className="text-xl font-semibold tabular-nums">{lot.data.reservedQuantity}</dd></div>
          <div className="rounded-md bg-muted/50 p-3"><dt className="text-sm text-muted-foreground">ขายได้</dt><dd className="text-xl font-semibold tabular-nums">{lot.data.sellableQuantity}</dd></div>
        </dl>
      </section>
      {lot.data.quarantineReason && <p className="text-sm text-muted-foreground">เหตุผลกักกัน: {lot.data.quarantineReason}</p>}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">ประวัติความเคลื่อนไหวของล็อต</h2>
          <p className="text-sm text-muted-foreground">ประวัติเป็นข้อมูลอ่านอย่างเดียวและกรองจากรหัสล็อตนี้โดยตรง</p>
        </div>
        <MovementTable
          canPrevious={canPrevious}
          error={movements.error}
          hasCursor={Boolean(cursor)}
          isPending={movements.isPending}
          isRefreshing={movements.isFetching && !movements.isPending}
          limit={limit}
          movements={movements.data?.items ?? []}
          nextCursor={movements.data?.nextCursor ?? null}
          onFirst={first}
          onLimitChange={setLimit}
          onNext={next}
          onPrevious={previous}
          onRetry={() => void movements.refetch()}
        />
      </section>
      <LotCommandDialog
        error={preflightError ?? currentCommand.error}
        isPending={currentCommand.isPending}
        kind={dialogKind}
        lot={lot.data}
        onDirtyChange={setDialogDirty}
        onOpenChange={setDialogOpen}
        onRetry={retryCommand}
        onSubmit={submitCommand}
        open={dialogOpen}
        uncertain={currentCommand.uncertain}
      />
      {unsavedConfirmation}
    </section>
  )
}
