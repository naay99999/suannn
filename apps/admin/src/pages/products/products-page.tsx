import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { ServerDataTable, type ServerDataTableFeatures, type ServerDataTableSorting, type SortDirection } from '@/components/server-data-table'
import { useCursorPagination } from '@/hooks/use-cursor-pagination'
import { productsQuery } from '@/lib/catalog/queries'
import type { CatalogListInput, ProductSummary } from '@/lib/catalog/api'
import { formatDateOnly } from '@/lib/format'
import { authSessionQuery } from '@/lib/auth-session'
import { hasPermission } from '@/lib/permissions'
import { cn } from '@workspace/ui/lib/utils'

const productFilters = ['q', 'status', 'category', 'sort', 'order'] as const
const statusLabels = { draft: 'ร่าง', published: 'เผยแพร่แล้ว', archived: 'เก็บถาวร' } as const
const categoryLabels = { fresh: 'สินค้าสด', processed: 'สินค้าแปรรูป' } as const
type ProductStatus = keyof typeof statusLabels
type ProductCategory = keyof typeof categoryLabels
const emptyProducts: ProductSummary[] = []
const column = createColumnHelper<ServerDataTableFeatures, ProductSummary>()
const columns: ColumnDef<ServerDataTableFeatures, ProductSummary>[] = column.columns([
  column.accessor('name', {
    header: 'สินค้า',
    cell: ({ row }) => (
      <div className="flex min-w-48 items-center gap-3">
        <ProductImage product={row.original} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link className="truncate font-medium text-primary underline-offset-4 hover:underline" to={`/products/${row.original.id}`}>
            {row.original.name}
          </Link>
          {row.original.englishName && <span className="truncate text-sm text-muted-foreground">{row.original.englishName}</span>}
          <span className="truncate text-xs text-muted-foreground">{row.original.slug}</span>
        </div>
      </div>
    ),
  }),
  column.accessor('category', {
    header: 'หมวดหมู่',
    cell: ({ getValue }) => categoryLabels[getValue()],
  }),
  column.accessor('status', {
    header: 'สถานะ',
    cell: ({ getValue }) => {
      const status = getValue()
      return <Badge variant={status === 'published' ? 'success' : status === 'draft' ? 'warning' : 'outline'}>{statusLabels[status]}</Badge>
    },
  }),
  column.accessor('createdAt', {
    header: 'สร้างเมื่อ',
    cell: ({ getValue }) => formatDateOnly(getValue().toISOString()),
  }),
  column.accessor('updatedAt', {
    header: 'แก้ไขล่าสุด',
    cell: ({ getValue }) => formatDateOnly(getValue().toISOString()),
  }),
])

type ProductSortField = NonNullable<NonNullable<CatalogListInput>['sort']>

const sortableColumns = {
  name: { initialDirection: 'asc' },
  category: { initialDirection: 'asc' },
  status: { initialDirection: 'asc' },
  createdAt: { initialDirection: 'desc' },
  updatedAt: { initialDirection: 'desc' },
} satisfies Record<ProductSortField, ServerDataTableSorting['columns'][string]>

function isSortField(value: string | null): value is ProductSortField {
  return value !== null && Object.hasOwn(sortableColumns, value)
}

function isSortDirection(value: string | null): value is SortDirection {
  return value === 'asc' || value === 'desc'
}

function isStatus(value: string | null): value is ProductStatus {
  return value !== null && Object.hasOwn(statusLabels, value)
}

function isCategory(value: string | null): value is ProductCategory {
  return value !== null && Object.hasOwn(categoryLabels, value)
}

function ProductImage({ product }: { product: ProductSummary }) {
  if (!product.coverImage) {
    return <div aria-label="ไม่มีรูปภาพ" className="grid size-12 shrink-0 place-items-center rounded-md bg-muted text-xs text-muted-foreground" role="img">ไม่มีรูป</div>
  }

  return <img alt={product.coverImage.alt || product.name} className="size-12 shrink-0 rounded-md border object-cover" decoding="async" height={48} loading="lazy" src={product.coverImage.thumbUrl} width={48} />
}

export function Component() {
  const location = useLocation()
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canCreate = hasPermission(session, 'catalog:create')
  const { cursor, limit, canPrevious, next, previous, first, setLimit, setFilters } = useCursorPagination(productFilters)
  const searchParams = new URLSearchParams(location.search)
  const searchQuery = searchParams.get('q') ?? ''
  const rawStatus = searchParams.get('status')
  const rawCategory = searchParams.get('category')
  const rawSort = searchParams.get('sort')
  const rawOrder = searchParams.get('order')
  const status = isStatus(rawStatus) ? rawStatus : undefined
  const category = isCategory(rawCategory) ? rawCategory : undefined
  const sort = isSortField(rawSort) ? rawSort : undefined
  const order = isSortDirection(rawOrder) ? rawOrder : undefined
  const [searchDraft, setSearchDraft] = useState({ query: searchQuery, value: searchQuery })
  const searchValue = searchDraft.query === searchQuery ? searchDraft.value : searchQuery
  useEffect(() => {
    if (searchValue === searchQuery) return
    const timeout = window.setTimeout(() => {
      setFilters({ q: searchValue })
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [searchQuery, searchValue, setFilters])

  // Filters and sort shared by every page of the current list; the cursor is only valid with exactly these.
  const listFilters: CatalogListInput = {
    ...(searchQuery ? { q: searchQuery } : {}),
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(sort ? { sort } : {}),
    ...(order ? { order } : {}),
  }
  const query: CatalogListInput = { ...listFilters, limit, cursor }
  const products = useQuery(productsQuery(query))
  const nextCursor = products.isPlaceholderData ? null : products.data?.nextCursor
  const hasFilters = Boolean(searchQuery || status || category)
  const activeSort = sort ?? 'createdAt'
  const sorting: ServerDataTableSorting = {
    field: activeSort,
    direction: order ?? sortableColumns[activeSort].initialDirection,
    columns: sortableColumns,
    onChange: (field, direction) => setFilters({ sort: field, order: direction, q: searchValue }),
    // A sort change returns to the first page, so warm exactly that query.
    onIntent: (field, direction) => {
      if (isSortField(field)) void queryClient.prefetchQuery(productsQuery({ ...listFilters, sort: field, order: direction, limit }))
    },
  }

  // Warm the next page so "next" renders from cache; staleTime keeps this from refetching on every render.
  useEffect(() => {
    if (!nextCursor) return
    void queryClient.prefetchQuery(productsQuery({
      ...(searchQuery ? { q: searchQuery } : {}),
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(sort ? { sort } : {}),
      ...(order ? { order } : {}),
      limit,
      cursor: nextCursor,
    }))
  }, [category, limit, nextCursor, order, queryClient, searchQuery, sort, status])

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">จัดการแค็ตตาล็อก</p>
          <h1 className="text-3xl font-semibold tracking-tight">สินค้า</h1>
          <p className="text-muted-foreground">ดูสินค้าและสถานะจากแค็ตตาล็อก</p>
        </div>
        {canCreate && <Link className={cn(buttonVariants(), 'w-fit')} to="/products/new">เพิ่มสินค้า</Link>}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          aria-label="ค้นหาสินค้า"
          className="sm:max-w-sm"
          onChange={(event) => setSearchDraft({ query: searchQuery, value: event.target.value })}
          placeholder="ค้นหาชื่อสินค้า ชื่ออังกฤษ หรือ slug"
          type="search"
          value={searchValue}
        />
        <Select
          items={[
            { label: 'ทุกสถานะ', value: 'all' },
            ...Object.entries(statusLabels).map(([value, label]) => ({ label, value })),
          ]}
          value={status ?? 'all'}
          onValueChange={(value) => setFilters({ status: value === 'all' ? undefined : value ?? undefined, q: searchValue })}
        >
          <SelectTrigger aria-label="กรองตามสถานะ" className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="all">ทุกสถานะ</SelectItem>
            {Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
        <Select
          items={[
            { label: 'ทุกหมวดหมู่', value: 'all' },
            ...Object.entries(categoryLabels).map(([value, label]) => ({ label, value })),
          ]}
          value={category ?? 'all'}
          onValueChange={(value) => setFilters({ category: value === 'all' ? undefined : value ?? undefined, q: searchValue })}
        >
          <SelectTrigger aria-label="กรองตามหมวดหมู่" className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="all">ทุกหมวดหมู่</SelectItem>
            {Object.entries(categoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
        {hasFilters && (
          <Button
            className="w-fit"
            onClick={() => setFilters({ q: undefined, status: undefined, category: undefined })}
            variant="ghost"
          >
            ล้างตัวกรอง
          </Button>
        )}
      </div>
      <ServerDataTable
        columns={columns}
        data={products.data?.items ?? emptyProducts}
        emptyDescription={hasFilters ? 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง' : 'สินค้าที่เพิ่มจะแสดงที่นี่'}
        emptyTitle={hasFilters ? 'ไม่พบสินค้าที่ตรงกับตัวกรอง' : 'ยังไม่มีสินค้า'}
        error={products.error}
        getRowId={(product) => product.id}
        isPending={products.isPending}
        isRefreshing={products.isFetching && !products.isPending}
        onRetry={() => void products.refetch()}
        sorting={sorting}
        pagination={{
          limit,
          nextCursor: products.data?.nextCursor ?? null,
          canPrevious,
          hasCursor: Boolean(cursor),
          onNext: next,
          onPrevious: previous,
          onFirst: first,
          onLimitChange: setLimit,
        }}
      />
    </section>
  )
}
