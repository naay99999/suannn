import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { buttonVariants } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { ServerDataTable, type ServerDataTableFeatures } from '@/components/server-data-table'
import { useCursorPagination } from '@/hooks/use-cursor-pagination'
import { productsQuery } from '@/lib/catalog/queries'
import type { CatalogListInput, ProductSummary } from '@/lib/catalog/api'
import { formatDateOnly } from '@/lib/format'
import { authSessionQuery } from '@/lib/auth-session'
import { hasPermission } from '@/lib/permissions'
import { cn } from '@workspace/ui/lib/utils'

const productFilters = ['q', 'status'] as const
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
    cell: ({ getValue }) => getValue() === 'fresh' ? 'สินค้าสด' : 'สินค้าแปรรูป',
  }),
  column.accessor('status', {
    header: 'สถานะ',
    cell: ({ getValue }) => {
      const status = getValue()
      const label = status === 'published' ? 'เผยแพร่แล้ว' : status === 'draft' ? 'ร่าง' : 'เก็บถาวร'
      return <Badge variant={status === 'published' ? 'default' : status === 'draft' ? 'secondary' : 'outline'}>{label}</Badge>
    },
  }),
  column.accessor('updatedAt', {
    header: 'แก้ไขล่าสุด',
    cell: ({ getValue }) => formatDateOnly(getValue().toISOString()),
  }),
])

function ProductImage({ product }: { product: ProductSummary }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (!product.imageUrl || failedUrl === product.imageUrl) {
    return <div aria-label="ไม่มีรูปภาพ" className="grid size-12 shrink-0 place-items-center rounded-md bg-muted text-xs text-muted-foreground" role="img">ไม่มีรูป</div>
  }

  return <img alt={product.imageAlt || product.name} className="size-12 shrink-0 rounded-md border object-cover" onError={() => setFailedUrl(product.imageUrl)} src={product.imageUrl} />
}

export function Component() {
  const location = useLocation()
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canCreate = hasPermission(session, 'catalog:create')
  const { cursor, limit, canPrevious, next, previous, first, setLimit, setFilters } = useCursorPagination(productFilters)
  const searchParams = new URLSearchParams(location.search)
  const searchQuery = searchParams.get('q') ?? ''
  const statusValue = searchParams.get('status')
  const status = statusValue === 'draft' || statusValue === 'published' || statusValue === 'archived' ? statusValue : undefined
  const [searchDraft, setSearchDraft] = useState({ query: searchQuery, value: searchQuery })
  const searchValue = searchDraft.query === searchQuery ? searchDraft.value : searchQuery
  useEffect(() => {
    if (searchValue === searchQuery) return
    const timeout = window.setTimeout(() => {
      setFilters({ q: searchValue })
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [searchQuery, searchValue, setFilters])

  const query: CatalogListInput = {
    q: searchQuery || undefined,
    status,
    limit,
    cursor,
  }
  const products = useQuery(productsQuery(query))

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">จัดการแค็ตตาล็อก</p>
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">สินค้า</h1>
          <p className="text-muted-foreground">ดูสินค้าและสถานะจากแค็ตตาล็อก</p>
        </div>
      </div>
      {canCreate && <Link className={cn(buttonVariants(), 'w-fit')} to="/products/new">เพิ่มสินค้า</Link>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          aria-label="ค้นหาสินค้า"
          className="sm:max-w-sm"
          onChange={(event) => setSearchDraft({ query: searchQuery, value: event.target.value })}
          placeholder="ค้นหาชื่อสินค้า"
          type="search"
          value={searchValue}
        />
        <Select
          items={[
            { label: 'ทุกสถานะ', value: 'all' },
            { label: 'ร่าง', value: 'draft' },
            { label: 'เผยแพร่แล้ว', value: 'published' },
            { label: 'เก็บถาวร', value: 'archived' },
          ]}
          value={status ?? 'all'}
          onValueChange={(value) => setFilters({ status: value === 'all' ? undefined : value ?? undefined, q: searchValue })}
        >
          <SelectTrigger aria-label="กรองตามสถานะ" className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="all">ทุกสถานะ</SelectItem>
            <SelectItem value="draft">ร่าง</SelectItem>
            <SelectItem value="published">เผยแพร่แล้ว</SelectItem>
            <SelectItem value="archived">เก็บถาวร</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
      </div>
      <ServerDataTable
        columns={columns}
        data={products.data?.items ?? emptyProducts}
        emptyDescription="ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ"
        emptyTitle="ยังไม่มีสินค้า"
        error={products.error}
        getRowId={(product) => product.id}
        isPending={products.isPending}
        isRefreshing={products.isFetching && !products.isPending}
        onRetry={() => void products.refetch()}
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
