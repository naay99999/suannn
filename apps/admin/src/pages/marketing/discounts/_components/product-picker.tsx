import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Input } from '@workspace/ui/components/input'
import { productsQuery } from '@/lib/catalog/queries'

// Archived products cannot be sold, so they are never offered; ids already saved stay selected.
export function ProductPicker({ value, onChange, disabled, invalid }: {
  value: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  invalid?: boolean
}) {
  const [search, setSearch] = useState('')
  const products = useQuery(productsQuery({ limit: 100, ...(search.trim() ? { q: search.trim() } : {}) }))
  const options = (products.data?.items ?? []).filter((product) => product.status !== 'archived')

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...value, id] : value.filter((existing) => existing !== id))
  }

  return (
    <div className="flex flex-col gap-2 rounded-field border p-3">
      <Input aria-label="ค้นหาสินค้า" disabled={disabled} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาชื่อสินค้า" value={search} />
      <p className="text-xs text-muted-foreground">เลือกแล้ว {value.length} รายการ</p>
      <ul aria-invalid={invalid} className="flex max-h-60 flex-col gap-2 overflow-y-auto">
        {products.isPending && <li className="text-sm text-muted-foreground">กำลังโหลดสินค้า...</li>}
        {products.isError && <li className="text-sm text-destructive">โหลดรายการสินค้าไม่สำเร็จ</li>}
        {!products.isPending && !products.isError && options.length === 0 && <li className="text-sm text-muted-foreground">ไม่พบสินค้า</li>}
        {options.map((product) => (
          <li className="flex items-center gap-2 text-sm" key={product.id}>
            <Checkbox aria-label={product.name} checked={value.includes(product.id)} disabled={disabled} id={`discount-product-${product.id}`} onCheckedChange={(checked) => toggle(product.id, checked)} />
            <label htmlFor={`discount-product-${product.id}`}>{product.name}</label>
          </li>
        ))}
      </ul>
    </div>
  )
}
