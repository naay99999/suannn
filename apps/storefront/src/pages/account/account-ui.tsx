import type { ReactNode } from 'react'
import { Badge } from '@workspace/ui/components/badge'
import { cn } from '@workspace/ui/lib/utils'
import type { CustomerOrder } from './account-api'
import { formatSatang, fulfilmentProgress, fulfilmentSteps, orderStatusLabels } from './order-display'

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

const orderStatusVariants: Partial<Record<CustomerOrder['status'], 'warning' | 'info' | 'success' | 'secondary'>> = {
  pending_payment: 'warning',
  shipped: 'info',
  delivered: 'success',
  cancelled: 'secondary',
}

export function OrderStatus({ status }: { status: CustomerOrder['status'] }) {
  return <Badge variant={orderStatusVariants[status] ?? 'outline'}>{orderStatusLabels[status]}</Badge>
}

export function FulfilmentProgress({ status }: { status: CustomerOrder['status'] }) {
  const progress = fulfilmentProgress(status)
  if (progress < 0) return null
  return (
    <ol aria-label="ความคืบหน้าการจัดส่ง" className="grid grid-cols-4 gap-1.5">
      {fulfilmentSteps.map((step, index) => <li key={step} aria-current={index === progress ? 'step' : undefined} className="flex min-w-0 flex-col gap-1.5">
        <span className={cn('h-2 rounded-full', index <= progress ? 'bg-primary' : 'bg-muted')} />
        <span className={cn('truncate text-xs', index === progress ? 'font-medium text-foreground' : 'text-muted-foreground', index !== progress && 'max-sm:sr-only')}>{orderStatusLabels[step]}</span>
      </li>)}
    </ol>
  )
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
    <ul className="flex flex-col divide-y">
      {order.items.map(item => <li key={item.id} className="flex min-w-0 items-baseline justify-between gap-4 py-4 first:pt-0 last:pb-0">
        <div className="min-w-0">
          <p className="font-medium">{item.productName}</p>
          <p className="mt-1 text-xs text-muted-foreground">{item.variantName} · {item.unit}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums">{formatSatang(item.lineTotalSatang)}</p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">{formatSatang(item.unitPriceSatang)} × {item.quantity}</p>
        </div>
      </li>)}
    </ul>
  )
}
