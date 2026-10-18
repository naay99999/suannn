import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { MoreHorizontalIcon } from '@hugeicons/core-free-icons'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { toast } from '@workspace/ui/components/toast'
import { ButtonSpinner } from '@/components/loading/button-spinner'
import { removeAddress, setDefaultAddress, type CustomerAddress } from './account-api'
import { addressQueryKey } from './account-queries'
import { AddressText } from './account-ui'
import { addressErrorMessage, defaultBadgeLabel, defaultSuccessor, removeAddressFromList, setDefaultInList } from './address-display'

type AddressList = { items: CustomerAddress[] }
type DefaultKind = 'shipping' | 'billing'

const defaultKindLabels: Record<DefaultKind, string> = { shipping: 'ที่อยู่จัดส่งหลัก', billing: 'ที่อยู่ออกใบเสร็จหลัก' }

export function AddressCard({ address, addresses, userId, onEdit }: {
  address: CustomerAddress
  // API (oldest-first) order, needed to predict which address inherits a removed default.
  addresses: CustomerAddress[]
  userId: string
  onEdit: () => void
}) {
  const queryClient = useQueryClient()
  const queryKey = addressQueryKey(userId)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [error, setError] = useState('')
  const titleId = `address-title-${address.id}`

  const defaultMutation = useMutation({
    mutationFn: (kind: DefaultKind) => setDefaultAddress(address.id, kind),
    onMutate: async kind => {
      setError('')
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<AddressList>(queryKey)
      queryClient.setQueryData<AddressList>(queryKey, data => data && { ...data, items: setDefaultInList(data.items, address.id, kind) })
      return { previous }
    },
    onError: (cause, _kind, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
      setError(addressErrorMessage(cause, 'default'))
    },
    onSuccess: (_saved, kind) => toast.add({ title: `ตั้ง ${address.label} เป็น${defaultKindLabels[kind]}แล้ว`, type: 'success' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })

  const removeMutation = useMutation({
    mutationFn: () => removeAddress(address.id),
    onSuccess: () => {
      setConfirmingRemoval(false)
      queryClient.setQueryData<AddressList>(queryKey, data => data && { ...data, items: removeAddressFromList(data.items, address.id) })
      void queryClient.invalidateQueries({ queryKey })
      toast.add({ title: `ลบที่อยู่ ${address.label} แล้ว`, type: 'success' })
    },
  })

  const badge = defaultBadgeLabel(address)
  const successor = defaultSuccessor(addresses, address.id)
  const inheritedKinds = [address.isDefaultShipping && 'จัดส่ง', address.isDefaultBilling && 'ออกใบเสร็จ'].filter(Boolean).join('และ')
  const busy = defaultMutation.isPending || removeMutation.isPending

  return (
    <Card aria-labelledby={titleId} role="article" aria-busy={busy}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle id={titleId} role="heading" aria-level={3} className="text-lg font-semibold">{address.label}</CardTitle>
        {badge && <Badge variant="secondary">{badge}</Badge>}
      </CardHeader>
      <CardContent className="gap-1 leading-7">
        <p className="font-medium">{address.recipientName}</p>
        <p className="tabular-nums text-muted-foreground">{address.phone}</p>
        <p className="text-muted-foreground"><AddressText address={address} /></p>
      </CardContent>
      <CardFooter className="mt-auto flex flex-col items-stretch gap-3">
        <div className="flex items-center gap-2">
          <Button id={`address-edit-${address.id}`} type="button" variant="outline" aria-label={`แก้ไขที่อยู่ ${address.label}`} onClick={onEdit}>แก้ไข</Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-(--control-h)" aria-label={`ตัวเลือกเพิ่มเติมสำหรับ ${address.label}`} disabled={busy} />}>
              {busy ? <ButtonSpinner show /> : <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {!address.isDefaultShipping && <DropdownMenuItem onClick={() => defaultMutation.mutate('shipping')}>ตั้งเป็นที่อยู่จัดส่งหลัก</DropdownMenuItem>}
              {!address.isDefaultBilling && <DropdownMenuItem onClick={() => defaultMutation.mutate('billing')}>ตั้งเป็นที่อยู่ออกใบเสร็จหลัก</DropdownMenuItem>}
              {(!address.isDefaultShipping || !address.isDefaultBilling) && <DropdownMenuSeparator />}
              <DropdownMenuItem variant="destructive" onClick={() => { setError(''); removeMutation.reset(); setConfirmingRemoval(true) }}>ลบที่อยู่</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardFooter>

      <Dialog open={confirmingRemoval} onOpenChange={open => { if (!removeMutation.isPending) setConfirmingRemoval(open) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบที่อยู่ {address.label}?</DialogTitle>
            <DialogDescription>
              {address.recipientName} · {address.addressLine1} {address.province}
              {successor ? ` · ที่อยู่ ${successor.label} จะกลายเป็นที่อยู่${inheritedKinds}หลักแทน` : ''}
              {' '}การลบย้อนกลับไม่ได้ แต่คำสั่งซื้อเดิมจะยังเก็บที่อยู่ไว้ตามเดิม
            </DialogDescription>
          </DialogHeader>
          {removeMutation.isError && <p role="alert" className="text-sm text-destructive">{addressErrorMessage(removeMutation.error, 'remove')}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={removeMutation.isPending} onClick={() => setConfirmingRemoval(false)}>เก็บไว้</Button>
            <Button variant="destructive" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate()}><ButtonSpinner show={removeMutation.isPending} />{removeMutation.isPending ? 'กำลังลบ...' : 'ลบที่อยู่'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
