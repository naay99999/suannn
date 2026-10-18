import type { ReactNode } from 'react'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { cn } from '@workspace/ui/lib/utils'
import { settingListClassName } from './account-styles'

// One row of a settings list: what it is, its current value, and an action that opens the editor in place.
export function SettingRow({ id, title, description, editing, action, children }: {
  id: string
  title: string
  description: string
  editing: boolean
  action: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={cn('grid gap-x-8 gap-y-4 px-5 py-6 transition-colors md:grid-cols-[11rem_minmax(0,1fr)_auto] md:px-6 motion-reduce:transition-none', editing && 'bg-muted/40')}>
      <div>
        <h3 id={`${id}-title`} className="font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-pretty text-muted-foreground">{description}</p>
      </div>
      <div className={cn('min-w-0', editing && 'md:col-span-2')}>{children}</div>
      {!editing && <div className="md:justify-self-end">{action}</div>}
    </section>
  )
}

export function SettingListSkeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <div role="status" aria-label={label} className={settingListClassName}>
      {Array.from({ length: rows }, (_, row) => <div key={row} className="grid gap-4 px-5 py-6 md:grid-cols-[11rem_minmax(0,1fr)_auto] md:px-6">
        <div className="flex flex-col gap-2"><Skeleton className="h-4 w-16" /><Skeleton className="h-3 w-36" /></div>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-(--control-h) w-24 rounded-control" />
      </div>)}
    </div>
  )
}
