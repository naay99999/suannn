import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { toast } from '@workspace/ui/components/toast'
import { cn } from '@workspace/ui/lib/utils'
import { authSessionQuery } from '@/lib/auth-session'
import { addressesQuery } from './account-queries'
import { AccountQueryFeedback } from './account-query-feedback'
import { AccountPageHeading } from './account-ui'
import { accountSurface, accountSurfacePadding } from './account-styles'
import { AddressCard } from './address-card'
import { addressLimit, sortAddresses } from './address-display'
import { AddressForm } from './address-form'

const newAddress = 'new'

export function Component() {
  const session = useQuery(authSessionQuery).data
  const userId = session?.user.id ?? ''
  const addresses = useQuery({ ...addressesQuery(userId), enabled: Boolean(userId) })
  const [editingId, setEditingId] = useState<string | null>(null)
  // Where focus goes back to once the form closes: the add button or the edited card's edit button.
  const returnFocusTo = useRef<string | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)

  const items = addresses.data?.items ?? []
  const sorted = sortAddresses(items)
  const atLimit = items.length >= addressLimit

  useEffect(() => {
    if (editingId || !returnFocusTo.current) return
    const target = returnFocusTo.current === newAddress ? addButton.current : document.getElementById(`address-edit-${returnFocusTo.current}`)
    target?.focus()
    returnFocusTo.current = null
  }, [editingId])

  function close(id: string) {
    returnFocusTo.current = id
    setEditingId(null)
  }

  function startAdding() {
    if (!atLimit) setEditingId(newAddress)
  }

  const addAction = <Button ref={addButton} onClick={startAdding} disabled={atLimit || editingId === newAddress} aria-describedby={atLimit ? 'address-limit-note' : undefined}>เพิ่มที่อยู่</Button>

  return (
    <>
      <title>ที่อยู่ของฉัน | suannn</title>
      <AccountPageHeading title="ที่อยู่ของฉัน" description="จัดการปลายทางสำหรับการจัดส่งและใบเสร็จ ที่อยู่หลักจะถูกเลือกให้อัตโนมัติตอนชำระเงิน" action={addresses.isSuccess && items.length > 0 ? addAction : undefined} />
      {atLimit && <p id="address-limit-note" className="-mt-4 mb-6 text-sm text-muted-foreground">บันทึกครบ {addressLimit} ที่อยู่แล้ว ลบที่อยู่ที่ไม่ใช้ก่อนเพิ่มใหม่</p>}
      {addresses.isPending ? <AddressesSkeleton /> : addresses.isError ? (
        <AccountQueryFeedback error={addresses.error} retry={() => void addresses.refetch()} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {editingId === newAddress && <AddressForm
            userId={userId}
            isFirst={items.length === 0}
            onCancel={() => close(newAddress)}
            onSaved={saved => { close(saved.id); toast.add({ title: `เพิ่มที่อยู่ ${saved.label} แล้ว`, type: 'success' }) }}
          />}
          {sorted.map(address => editingId === address.id
            ? <AddressForm
              key={address.id}
              userId={userId}
              address={address}
              isFirst={false}
              onCancel={() => close(address.id)}
              onSaved={saved => { close(saved.id); toast.add({ title: `บันทึกที่อยู่ ${saved.label} แล้ว`, type: 'success' }) }}
            />
            : <AddressCard key={address.id} address={address} addresses={items} userId={userId} onEdit={() => setEditingId(address.id)} />)}
          {!items.length && editingId !== newAddress && <Empty className="rounded-surface border border-dashed py-14 xl:col-span-2">
            <EmptyHeader><EmptyTitle>ยังไม่มีที่อยู่</EmptyTitle><EmptyDescription>บันทึกที่อยู่ไว้ครั้งเดียว แล้วเลือกใช้ได้ทันทีตอนชำระเงิน</EmptyDescription></EmptyHeader>
            <EmptyContent>{addAction}</EmptyContent>
          </Empty>}
        </div>
      )}
    </>
  )
}

function AddressesSkeleton() {
  return (
    <div role="status" aria-label="กำลังโหลดที่อยู่" className="grid gap-5 xl:grid-cols-2">
      {[0, 1].map(card => <div key={card} className={cn('flex flex-col gap-4', accountSurface, accountSurfacePadding)}>
        <div className="flex justify-between gap-4"><Skeleton className="h-5 w-24" /><Skeleton className="h-5 w-20" /></div>
        <div className="flex flex-col gap-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-28" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>
        <div className="flex gap-2"><Skeleton className="h-(--control-h) w-20 rounded-control" /><Skeleton className="size-(--control-h) rounded-control" /></div>
      </div>)}
    </div>
  )
}
