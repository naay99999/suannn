import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { buttonVariants } from '@workspace/ui/components/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { cn } from '@workspace/ui/lib/utils'
import { QueryState } from '@/components/query-state'
import { apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { discountStatusLabels } from '@/lib/discounts/labels'
import { discountsQuery } from '@/lib/discounts/queries'
import { hasPermission } from '@/lib/permissions'
import { DiscountsTable } from './_components/discounts-table'

type StatusFilter = 'all' | keyof typeof discountStatusLabels

const statusItems: { label: string; value: StatusFilter }[] = [
  { label: 'ทุกสถานะ', value: 'all' },
  ...Object.entries(discountStatusLabels).map(([value, { label }]) => ({ label, value: value as StatusFilter })),
]

export function Component() {
  const { data: session } = useQuery(authSessionQuery)
  const canCreate = hasPermission(session, 'marketing:update')
  const discounts = useQuery(discountsQuery)
  const [status, setStatus] = useState<StatusFilter>('all')
  const items = (discounts.data?.items ?? []).filter((item) => status === 'all' || item.status === status)

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 lg:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-headline font-semibold tracking-tight">โค้ดส่วนลด</h1>
          <p className="text-muted-foreground">สร้างและติดตามโค้ดส่วนลดที่ลูกค้ากรอกตอนชำระเงิน</p>
        </div>
        {canCreate && <Link className={cn(buttonVariants(), 'w-fit')} to="/marketing/discounts/new">สร้างโค้ด</Link>}
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <Select items={statusItems} onValueChange={(value) => value && setStatus(value as StatusFilter)} value={status}>
          <SelectTrigger aria-label="กรองตามสถานะ" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent><SelectGroup>
            {statusItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
      </div>
      {discounts.isPending
        ? <QueryState kind="loading" />
        : discounts.isError
          ? <QueryState kind="error" message={apiErrorMessage(discounts.error)} onRetry={() => void discounts.refetch()} />
          : <DiscountsTable discounts={items} filtered={status !== 'all'} />}
    </section>
  )
}
