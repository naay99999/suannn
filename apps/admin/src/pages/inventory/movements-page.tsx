import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { QueryState } from '@/components/query-state'
import { useCursorPagination } from '@/hooks/use-cursor-pagination'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { productQuery } from '@/lib/catalog/queries'
import { movementsQuery, warehouseQuery } from '@/lib/inventory/queries'
import { hasPermission } from '@/lib/permissions'
import { CopyableId } from './_components/copyable-id'
import { InventoryNavigation } from './_components/inventory-navigation'
import { MovementTable } from './_components/movement-table'

function requestState(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 403) return { kind: 'forbidden' as const, message: 'ไม่มีสิทธิ์ดูประวัติสต็อก' }
  if (error instanceof ApiRequestError && error.status === 404) return { kind: 'not-found' as const, message: 'ไม่พบคลังสินค้าหลัก' }
  return { kind: 'error' as const, message: apiErrorMessage(error) }
}

export function Component() {
  const location = useLocation()
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canReadCatalog = hasPermission(session, 'catalog:read')
  const { cursor, limit, canPrevious, next, previous, first, setLimit, setFilters } = useCursorPagination(['variantId', 'lotId', 'productId'])
  const searchParams = new URLSearchParams(location.search)
  const initialVariantId = searchParams.get('variantId') ?? ''
  const initialLotId = searchParams.get('lotId') ?? ''
  const [draft, setDraft] = useState({ search: location.search, variantId: initialVariantId, lotId: initialLotId })
  const variantDraft = draft.search === location.search ? draft.variantId : initialVariantId
  const lotDraft = draft.search === location.search ? draft.lotId : initialLotId
  const variantId = searchParams.get('variantId') || undefined
  const lotId = searchParams.get('lotId') || undefined
  const productId = searchParams.get('productId') || undefined
  const product = useQuery({ ...productQuery(productId ?? ''), enabled: Boolean(productId && canReadCatalog) })
  const selectedVariant = productId && product.data?.id === productId
    ? product.data.variants.find((variant) => variant.id === variantId)
    : undefined
  const warehouse = useQuery(warehouseQuery())
  const movements = useQuery({
    ...movementsQuery({ warehouseId: warehouse.data?.id, variantId, lotId, limit, cursor }),
    enabled: Boolean(warehouse.data),
  })

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFilters({ variantId: variantDraft, lotId: lotDraft, productId: undefined })
  }

  if (warehouse.isPending) return <section className="px-4 lg:px-6"><QueryState kind="loading" /></section>
  if (warehouse.error) {
    const state = requestState(warehouse.error)
    return <section className="px-4 lg:px-6"><QueryState kind={state.kind} message={state.message} onRetry={state.kind === 'error' ? () => void warehouse.refetch() : undefined} /></section>
  }

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">ประวัติความเคลื่อนไหวสต็อก</h1>
        <p className="text-sm text-muted-foreground">คลังหลัก · {warehouse.data.name} ({warehouse.data.code})</p>
      </div>
      <InventoryNavigation variantId={variantId} lotId={lotId} productId={productId} />
      {productId && !canReadCatalog && <p className="text-sm text-muted-foreground" role="status">ไม่มีสิทธิ์อ่านข้อมูลสินค้า จะแสดงตัวกรองด้วยรหัสรูปแบบสินค้า</p>}
      {variantId && selectedVariant && product.data && <div className="flex flex-col gap-1 rounded-lg border p-4 text-sm">
        <span className="font-medium">ตัวกรองรูปแบบสินค้า</span>
        <span>{product.data.name} · {selectedVariant.sku} · {selectedVariant.name} ({selectedVariant.unit})</span>
        <CopyableId label="รหัสรูปแบบสินค้า" value={variantId} />
      </div>}
      {productId && product.data && !selectedVariant && <p className="text-sm text-muted-foreground" role="status">ไม่พบรูปแบบสินค้าในบริบทที่ระบุ จะแสดงรายการด้วยตัวกรองรหัสที่เลือก</p>}
      <form className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={submitFilters}>
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="movement-variant-filter">
          รหัสรูปแบบสินค้า
          <Input id="movement-variant-filter" onChange={(event) => setDraft({ search: location.search, variantId: event.target.value, lotId: lotDraft })} value={variantDraft} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="movement-lot-filter">
          รหัสล็อต
          <Input id="movement-lot-filter" onChange={(event) => setDraft({ search: location.search, variantId: variantDraft, lotId: event.target.value })} value={lotDraft} />
        </label>
        <Button type="submit">ใช้ตัวกรอง</Button>
      </form>
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
  )
}
