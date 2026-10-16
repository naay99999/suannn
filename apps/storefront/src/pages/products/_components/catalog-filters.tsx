import { useId } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Input } from '@workspace/ui/components/input'
import { Field, FieldLabel } from '@workspace/ui/components/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group'
import { readCatalogFilters, updateCatalogParams, type StoreProductQuery } from '@/lib/store-products'

const categories = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'fresh', label: 'ผลไม้สด' },
  { value: 'processed', label: 'แปรรูป' },
]
const sortOptions = [
  { value: 'newest', label: 'มาใหม่' },
  { value: 'price-asc', label: 'ราคา: น้อยไปมาก' },
  { value: 'price-desc', label: 'ราคา: มากไปน้อย' },
]

export function CatalogFilters({ fixedCategory }: { fixedCategory?: StoreProductQuery['category'] }) {
  const [params, setParams] = useSearchParams()
  const filters = readCatalogFilters(params)
  const selectedCategory = categories.find(category => category.value === (fixedCategory ?? filters.category ?? 'all'))!

  return <aside aria-label="หมวดหมู่สินค้า" className="min-w-0 self-start border-b pb-4 @min-[900px]/catalog:border-b-0 @min-[900px]/catalog:pb-0">
    {fixedCategory ? <Field>
      <FieldLabel>หมวดหมู่</FieldLabel>
      <p className="flex min-h-11 items-center text-sm font-medium">{selectedCategory.label}</p>
      <Link to="/products" className="inline-flex min-h-11 items-center text-sm text-primary-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">ดูสินค้าทั้งหมด</Link>
    </Field> : <Field>
      <FieldLabel className="hidden @min-[900px]/catalog:flex">หมวดหมู่</FieldLabel>
      <ToggleGroup aria-label="หมวดหมู่สินค้า" value={[selectedCategory.value]}
        className="w-full flex-wrap @min-[900px]/catalog:flex-col @min-[900px]/catalog:items-stretch"
        onValueChange={values => {
          if (values[0]) setParams(previous => updateCatalogParams(previous, 'category', values[0]!), { preventScrollReset: true })
        }}>
        {categories.map(category => <ToggleGroupItem key={category.value} value={category.value}
          className="min-h-11 flex-1 px-3 @min-[900px]/catalog:justify-start">
          {category.label}
        </ToggleGroupItem>)}
      </ToggleGroup>
    </Field>}
  </aside>
}

export function CatalogToolbar({ count, pending, fetching, failed }: { count: number; pending: boolean; fetching: boolean; failed: boolean }) {
  const [params, setParams] = useSearchParams()
  const filters = readCatalogFilters(params)
  const sortLabelId = useId()

  return <div className="mb-3 flex flex-col gap-2 @min-[900px]/catalog:mb-5 @min-[900px]/catalog:flex-row @min-[900px]/catalog:items-center @min-[900px]/catalog:gap-4">
    <Field className="@min-[900px]/catalog:min-w-0 @min-[900px]/catalog:max-w-sm @min-[900px]/catalog:flex-1">
      <FieldLabel htmlFor="product-search" className="sr-only">ค้นหาของอร่อย</FieldLabel>
      <Input id="product-search" type="search" placeholder="ค้นหาสินค้า" className="h-11" value={filters.q ?? ''}
        onChange={event => setParams(previous => updateCatalogParams(previous, 'q', event.target.value), { replace: true, preventScrollReset: true })} />
    </Field>
    <div className="flex min-h-11 items-center justify-between gap-2 @min-[900px]/catalog:ml-auto @min-[900px]/catalog:shrink-0 @min-[900px]/catalog:gap-4">
      <p role="status" aria-live="polite" className="min-w-0 text-sm text-muted-foreground">
        {pending ? 'กำลังโหลดสินค้า...' : failed ? 'โหลดรายการสินค้าไม่ได้' : fetching ? 'กำลังอัปเดตรายการ...' : `${count} รายการ`}
      </p>
      <Field className="w-auto shrink-0">
        <FieldLabel id={sortLabelId} className="sr-only">เรียงตาม</FieldLabel>
        <Select items={sortOptions} value={filters.sort ?? 'newest'} onValueChange={value => {
          if (value) setParams(previous => updateCatalogParams(previous, 'sort', value), { preventScrollReset: true })
        }}>
          <SelectTrigger aria-labelledby={sortLabelId} className="w-auto min-w-28 max-w-48 data-[size=default]:h-11"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{sortOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </Field>
    </div>
  </div>
}
