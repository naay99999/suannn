import { useSearchParams } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Field, FieldLabel } from '@workspace/ui/components/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group'
import { readCatalogFilters } from '@/lib/catalog'

const availabilityOptions = [
  { value: 'all', label: 'ทุกสถานะ' },
  { value: 'in-season', label: 'อยู่ในฤดูกาล' },
  { value: 'coming-soon', label: 'รอฤดูกาลถัดไป' },
]
const sortOptions = [
  { value: 'recommended', label: 'สวนแนะนำ' },
  { value: 'price-asc', label: 'ราคา: น้อยไปมาก' },
  { value: 'price-desc', label: 'ราคา: มากไปน้อย' },
]

export function CatalogFilters({ count }: { count: number }) {
  const [params, setParams] = useSearchParams()
  const filters = readCatalogFilters(params)
  function update(key: string, value: string, replace = false) {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      if (!value || value === 'all' || value === 'recommended') next.delete(key)
      else next.set(key, value)
      return next
    }, { replace, preventScrollReset: true })
  }
  return (
    <div className="catalog-toolbar flex flex-col gap-4 rounded-3xl border p-4 md:gap-6 md:p-7">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_200px]">
        <Field>
          <FieldLabel htmlFor="product-search">ค้นหาของอร่อย</FieldLabel>
          <Input id="product-search" type="search" placeholder="ลองค้นหา มะม่วง หรือ แยมส้ม" value={filters.q}
            onChange={event => update('q', event.target.value, true)} />
        </Field>
        <div className="hidden md:contents"><FilterSelects filters={filters} update={update} prefix="desktop" /></div>
      </div>
      <details className="rounded-xl border px-4 py-3 md:hidden">
        <summary className="cursor-pointer text-sm font-medium">สถานะและการเรียง</summary>
        <div className="grid gap-4 pt-4"><FilterSelects filters={filters} update={update} prefix="mobile" /></div>
      </details>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ToggleGroup aria-label="หมวดหมู่สินค้า" value={[filters.category]} onValueChange={value => { if (value[0]) update('category', value[0]) }} className="flex-wrap">
          <ToggleGroupItem value="all">ทั้งหมด</ToggleGroupItem>
          <ToggleGroupItem value="fresh">ผลไม้สด</ToggleGroupItem>
          <ToggleGroupItem value="processed">แปรรูป</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">พบ {count} รายการ</p>
          {params.size > 0 && <Button variant="ghost" size="sm" onClick={() => setParams({}, { preventScrollReset: true })}>ล้างตัวกรอง</Button>}
        </div>
      </div>
    </div>
  )
}

function FilterSelects({ filters, update, prefix }: {
  filters: ReturnType<typeof readCatalogFilters>
  update: (key: string, value: string) => void
  prefix: string
}) {
  return <>
    <Field>
      <FieldLabel id={`${prefix}-availability-label`}>สถานะตัวอย่าง</FieldLabel>
      <Select items={availabilityOptions} value={filters.availability} onValueChange={value => { if (value) update('availability', value) }}>
        <SelectTrigger aria-labelledby={`${prefix}-availability-label`} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{availabilityOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </Field>
    <Field>
      <FieldLabel id={`${prefix}-sort-label`}>เรียงตาม</FieldLabel>
      <Select items={sortOptions} value={filters.sort} onValueChange={value => { if (value) update('sort', value) }}>
        <SelectTrigger aria-labelledby={`${prefix}-sort-label`} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{sortOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </Field>
  </>
}
