import type { ReactNode } from 'react'
import { Badge } from '@workspace/ui/components/badge'
import { cn } from '@workspace/ui/lib/utils'
import type { CustomerOrder } from './account-api'
import { formatSatang, orderStatusLabels } from './order-display'

export function AccountPageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h2>
        {description && <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function OrderStatus({ status }: { status: CustomerOrder['status'] }) {
  return <Badge variant={status === 'delivered' ? 'secondary' : 'outline'} className={cn('rounded-full', status === 'delivered' && 'text-primary-ink')}>{orderStatusLabels[status]}</Badge>
}

export interface AddressDisplay {
  addressLine1: string
  addressLine2: string | null
  subdistrict: string
  district: string
  province: string
  postalCode: string
}

export function AddressText({ address }: { address: AddressDisplay }) {
  return <span className="leading-7">{address.addressLine1}{address.addressLine2 && ` ${address.addressLine2}`}<br />{address.subdistrict} {address.district} {address.province} {address.postalCode}</span>
}

export function OrderItems({ order }: { order: CustomerOrder }) {
  return (
    <ul className="flex flex-col gap-5">
      {order.items.map(item => <li key={item.id} className="flex min-w-0 flex-wrap justify-between gap-4 border-b pb-4 last:border-0 last:pb-0">
        <div className="min-w-0"><p className="font-medium">{item.productName}</p><p className="mt-1 text-xs text-muted-foreground">{item.variantName} · {item.unit} · จำนวน {item.quantity}</p></div>
        <p className="font-semibold tabular-nums text-primary-ink">{formatSatang(item.lineTotalSatang)}</p>
      </li>)}
    </ul>
  )
}
