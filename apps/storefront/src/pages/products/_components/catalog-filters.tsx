import { useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { FilterHorizontalIcon } from '@hugeicons/core-free-icons'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Field, FieldLabel } from '@workspace/ui/components/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { cn } from '@workspace/ui/lib/utils'
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
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const selectedCategory = categories.find(category => category.value === (fixedCategory ?? filters.category ?? 'all'))!

  return <aside aria-label="ตัวกรองสินค้า" className="min-w-0 self-start">
    <Field>
      <FieldLabel htmlFor="product-search">ค้นหาของอร่อย</FieldLabel>
      <Input id="product-search" type="search" placeholder="ค้นหาสินค้า" className="h-11" value={filters.q ?? ''}
        onChange={event => setParams(previous => updateCatalogParams(previous, 'q', event.target.value), { replace: true, preventScrollReset: true })} />
    </Field>
    {fixedCategory ? <div className="mt-5 flex flex-col gap-2">
      <p className="text-sm font-semibold">หมวดหมู่: {selectedCategory.label}</p>
      <Link to="/products" className="inline-flex min-h-11 items-center text-sm text-primary-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">ดูสินค้าทั้งหมด</Link>
    </div> : <div className="mt-4">
      <Button variant="ghost" className="min-h-11 w-full justify-start px-0 @min-[900px]/catalog:hidden" aria-controls={panelId} aria-expanded={open} onClick={() => setOpen(!open)}>
        <HugeiconsIcon icon={FilterHorizontalIcon} data-icon="inline-start" />
        {open ? 'ซ่อนหมวดหมู่' : `หมวดหมู่: ${selectedCategory.label}`}
      </Button>
      <div id={panelId} className={cn('mt-2 @min-[900px]/catalog:block', !open && 'hidden')}>
        <h2 className="mb-2 hidden text-sm font-semibold @min-[900px]/catalog:block">หมวดหมู่</h2>
        <div role="group" aria-label="หมวดหมู่สินค้า" className="flex flex-col gap-1">
          {categories.map(category => <Button key={category.value} variant="ghost" aria-pressed={category.value === selectedCategory.value}
            className={cn('min-h-11 justify-start rounded-none border-0 border-l-2 border-transparent px-3', category.value === selectedCategory.value && 'border-primary font-semibold text-primary-ink')}
            onClick={() => setParams(previous => updateCatalogParams(previous, 'category', category.value), { preventScrollReset: true })}>
            {category.label}
          </Button>)}
        </div>
      </div>
    </div>}
  </aside>
}

export function CatalogToolbar({ count, pending, fetching, failed }: { count: number; pending: boolean; fetching: boolean; failed: boolean }) {
  const [params, setParams] = useSearchParams()
  const filters = readCatalogFilters(params)
  const sortLabelId = useId()
  const hasFilters = Boolean(filters.q || filters.category || filters.sort)

  return <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div className="flex min-h-11 flex-wrap items-center gap-2">
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {pending ? 'กำลังโหลดสินค้า...' : failed ? 'โหลดรายการสินค้าไม่ได้' : fetching ? 'กำลังอัปเดตรายการ...' : `แสดง ${count} รายการ`}
      </p>
      {hasFilters && <Button variant="ghost" className="min-h-11" onClick={() => setParams({}, { preventScrollReset: true })}>ล้างตัวกรอง</Button>}
    </div>
    <Field className="w-full @min-[500px]/catalog:w-48">
      <FieldLabel id={sortLabelId} className="sr-only">เรียงตาม</FieldLabel>
      <Select items={sortOptions} value={filters.sort ?? 'newest'} onValueChange={value => {
        if (value) setParams(previous => updateCatalogParams(previous, 'sort', value), { preventScrollReset: true })
      }}>
        <SelectTrigger aria-labelledby={sortLabelId} className="w-full data-[size=default]:h-11"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{sortOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </Field>
  </div>
}
