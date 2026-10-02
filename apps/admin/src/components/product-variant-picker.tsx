import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { QueryState } from '@/components/query-state'
import { catalogApi, type ProductDetail, type Variant } from '@/lib/catalog/api'
import { catalogKeys, productQuery } from '@/lib/catalog/queries'

export type VariantSelection = { productId: string; variant: Variant; productName: string }

type ProductVariantPickerProps = {
  value: VariantSelection | null
  onChange: (selection: VariantSelection | null) => void
  disabled?: boolean
}

function ProductVariants({ product, onSelect }: { product: ProductDetail; onSelect: (variant: Variant) => void }) {
  const variants = product.variants.filter((variant) => !variant.archivedAt)

  return (
    <section aria-label={`รูปแบบสินค้าของ ${product.name}`} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">เลือกรูปแบบสินค้า</h3>
      {variants.length > 0
        ? <ul className="flex flex-col gap-2">
          {variants.map((variant) => <li key={variant.id}>
            <Button className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => onSelect(variant)} type="button" variant="outline">
              {variant.sku} · {variant.name} · {variant.unit}
            </Button>
          </li>)}
        </ul>
        : <p className="text-sm text-muted-foreground">สินค้านี้ยังไม่มีรูปแบบที่ใช้งานอยู่</p>}
    </section>
  )
}

export function ProductVariantPicker({ value, onChange, disabled = false }: ProductVariantPickerProps) {
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(draft.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [draft])

  const results = useInfiniteQuery({
    queryKey: [...catalogKeys.all, 'variant-picker', search] as const,
    queryFn: ({ pageParam }) => catalogApi.list({ q: search, limit: 25, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: search.length > 0,
  })
  const selectedProduct = useQuery({
    ...productQuery(selectedProductId ?? ''),
    enabled: Boolean(selectedProductId),
  })

  function changeSearch(nextValue: string) {
    setDraft(nextValue)
    setSelectedProductId(null)
    onChange(null)
  }

  function selectVariant(variant: Variant) {
    const product = selectedProduct.data
    if (!product || variant.productId !== product.id) return
    onChange({ productId: product.id, variant, productName: product.name })
  }

  const products = results.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">เลือกสินค้าและรูปแบบ</h2>
        <p className="text-sm text-muted-foreground">ค้นหาสินค้าก่อน แล้วเลือกรูปแบบสินค้าที่ใช้งานอยู่</p>
      </div>
      {value && <p aria-live="polite" className="text-sm" role="status">
        เลือกแล้ว: {value.productName} · {value.variant.sku} · {value.variant.name} ({value.variant.unit})
      </p>}
      <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="inventory-product-search">
        ค้นหาสินค้า
        <Input
          aria-label="ค้นหาสินค้าเพื่อเลือกสต็อก"
          autoComplete="off"
          disabled={disabled}
          id="inventory-product-search"
          onChange={(event) => changeSearch(event.target.value)}
          placeholder="พิมพ์ชื่อสินค้า"
          role="searchbox"
          value={draft}
        />
      </label>
      {results.isPending && search && <p aria-live="polite" className="text-sm text-muted-foreground" role="status">กำลังค้นหาสินค้า...</p>}
      {results.error && <QueryState kind="error" message="ค้นหาสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง" onRetry={() => void results.refetch()} />}
      {products.length > 0 && <ul aria-label="ผลการค้นหาสินค้า" className="flex flex-col gap-2">
        {products.map((product) => <li key={product.id}>
          <Button
            aria-pressed={selectedProductId === product.id}
            className="h-auto w-full justify-start whitespace-normal text-left"
            disabled={disabled}
            onClick={() => setSelectedProductId(product.id)}
            type="button"
            variant={selectedProductId === product.id ? 'secondary' : 'outline'}
          >
            {product.name} · {product.slug}
          </Button>
        </li>)}
      </ul>}
      {results.hasNextPage && <Button disabled={disabled || results.isFetchingNextPage} onClick={() => void results.fetchNextPage()} type="button" variant="outline">
        {results.isFetchingNextPage ? 'กำลังโหลด...' : 'โหลดสินค้าเพิ่มเติม'}
      </Button>}
      {search && !results.isPending && !results.error && products.length === 0 && <p className="text-sm text-muted-foreground">ไม่พบสินค้าที่ค้นหา</p>}
      {selectedProductId && selectedProduct.isPending && <p aria-live="polite" className="text-sm text-muted-foreground" role="status">กำลังโหลดรูปแบบสินค้า...</p>}
      {selectedProductId && selectedProduct.error && <QueryState kind="error" message="โหลดรูปแบบสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง" onRetry={() => void selectedProduct.refetch()} />}
      {selectedProduct.data && <ProductVariants product={selectedProduct.data} onSelect={selectVariant} />}
    </section>
  )
}
