import { useRef, useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@workspace/ui/components/dialog'
import { cancelOrderErrorMessage, type StoreOrderDetail } from '@/lib/store-orders'

export function CancelOrderDialog({ orderNumber, cancel, onCancelled }: {
  orderNumber: string
  cancel: (idempotencyKey: string) => Promise<StoreOrderDetail>
  onCancelled: (order: StoreOrderDetail) => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  // Reuse one key for every retry of this order so a lost response cannot cancel twice.
  const idempotencyKey = useRef(crypto.randomUUID())

  async function confirm() {
    setPending(true)
    setError('')
    try {
      const order = await cancel(idempotencyKey.current)
      setOpen(false)
      onCancelled(order)
    } catch (cause) {
      setError(cancelOrderErrorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!pending) { setOpen(next); setError('') } }}>
      <DialogTrigger render={<Button variant="destructive" />}>ยกเลิกคำสั่งซื้อ</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ยกเลิกคำสั่งซื้อ {orderNumber}?</DialogTitle>
          <DialogDescription>ร้านจะหยุดเตรียมสินค้าและคืนสินค้ากลับเข้าสต็อก การยกเลิกย้อนกลับไม่ได้</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>เก็บคำสั่งซื้อไว้</Button>
          <Button variant="destructive" disabled={pending} onClick={() => void confirm()}>{pending ? 'กำลังยกเลิก...' : 'ยืนยันการยกเลิก'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
