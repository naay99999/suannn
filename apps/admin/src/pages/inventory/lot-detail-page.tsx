import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { buttonVariants } from '@workspace/ui/components/button'
import { QueryState } from '@/components/query-state'
import { useCursorPagination } from '@/hooks/use-cursor-pagination'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { formatDateOnly, formatTimestamp } from '@/lib/format'
import { lotQuery, movementsQuery } from '@/lib/inventory/queries'
import { cn } from '@workspace/ui/lib/utils'
import { CopyableId } from './_components/copyable-id'
import { InventoryNavigation } from './_components/inventory-navigation'
import { MovementTable } from './_components/movement-table'

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
  const { cursor, limit, canPrevious, next, previous, first, setLimit } = useCursorPagination([])
  const lot = useQuery({ ...lotQuery(lotId ?? ''), enabled: Boolean(lotId) })
  const movements = useQuery({
    ...movementsQuery({ lotId, limit, cursor }),
    enabled: Boolean(lot.data),
  })

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
    </section>
  )
}
