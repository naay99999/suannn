import { useSearchParams } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Field, FieldLabel } from '@workspace/ui/components/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group'
import { readCatalogFilters, updateCatalogParams, type StoreProductQuery } from '@/lib/store-products'

const sortOptions = [
  { value: 'newest', label: 'มาใหม่' },
  { value: 'price-asc', label: 'ราคา: น้อยไปมาก' },
  { value: 'price-desc', label: 'ราคา: มากไปน้อย' },
]

export function CatalogFilters({ count, fixedCategory }: { count: number; fixedCategory?: StoreProductQuery['category'] }) {
  const [params, setParams] = useSearchParams()
  const filters = readCatalogFilters(params)
  function update(key: 'q' | 'category' | 'sort', value: string, replace = false) {
    setParams(previous => updateCatalogParams(previous, key, value), { replace, preventScrollReset: true })
  }
  return (
    <div className="catalog-toolbar flex flex-col gap-4 rounded-3xl border p-4 md:gap-6 md:p-7">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <Field>
          <FieldLabel htmlFor="product-search">ค้นหาของอร่อย</FieldLabel>
          <Input id="product-search" type="search" placeholder="ค้นหาสินค้า" value={filters.q ?? ''}
            onChange={event => update('q', event.target.value, true)} />
        </Field>
        <Field>
          <FieldLabel id="desktop-sort-label">เรียงตาม</FieldLabel>
          <SortSelect filters={filters} update={update} prefix="desktop" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        {fixedCategory ? <p className="text-sm font-medium">หมวดหมู่: {fixedCategory === 'fresh' ? 'ผลไม้สด' : 'ผลิตภัณฑ์แปรรูป'}</p> : (
          <ToggleGroup aria-label="หมวดหมู่สินค้า" value={[filters.category ?? 'all']} onValueChange={value => { if (value[0]) update('category', value[0]) }} className="flex-wrap">
            <ToggleGroupItem value="all">ทั้งหมด</ToggleGroupItem>
            <ToggleGroupItem value="fresh">ผลไม้สด</ToggleGroupItem>
            <ToggleGroupItem value="processed">แปรรูป</ToggleGroupItem>
          </ToggleGroup>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">พบ {count} รายการ</p>
          {params.size > 0 && <Button variant="ghost" size="sm" onClick={() => setParams({}, { preventScrollReset: true })}>ล้างตัวกรอง</Button>}
        </div>
      </div>
    </div>
  )
}

function SortSelect({ filters, update, prefix }: {
  filters: ReturnType<typeof readCatalogFilters>
  update: (key: 'q' | 'category' | 'sort', value: string) => void
  prefix: string
}) {
  return <>
    <Select items={sortOptions} value={filters.sort ?? 'newest'} onValueChange={value => { if (value) update('sort', value) }}>
      <SelectTrigger aria-labelledby={`${prefix}-sort-label`} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{sortOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </>
}
