import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Textarea } from '@workspace/ui/components/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import type { OrderCommand } from '@/lib/orders/api'
import { carrierLabels, trackingNumberPattern, type Carrier } from '@/lib/orders/shipment'

const titles: Record<OrderCommand['kind'], string> = { fulfillment: 'อัปเดตการจัดส่ง', cancel: 'ยกเลิกคำสั่งซื้อ', collectCod: 'บันทึกรับเงินปลายทาง', refund: 'ขอคืนเงินเต็มจำนวน', reissue: 'ส่งลิงก์ติดตามใหม่', revoke: 'เพิกถอนลิงก์ติดตาม', issueReceipt: 'ออกใบเสร็จ', cancelReceipt: 'ยกเลิกใบเสร็จ' }

export function OrderCommandDialog({ open, kind, totalSatang, nextStatus, pending, uncertain, error, onOpenChange, onSubmit, onRetry }: {
  open: boolean
  kind: OrderCommand['kind'] | null
  totalSatang: number
  nextStatus: 'processing' | 'packed' | 'shipped' | 'delivered' | null
  pending: boolean
  uncertain: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (command: OrderCommand) => void
  onRetry: () => void
}) {
  const [reasonCode, setReasonCode] = useState<'customer_request' | 'suspected_compromise' | 'support_recovery'>('support_recovery')
  const [receiptReason, setReceiptReason] = useState('')
  const [carrier, setCarrier] = useState<Carrier>('thailand_post')
  const [carrierName, setCarrierName] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
  if (!kind) return null
  const needsShipment = kind === 'fulfillment' && nextStatus === 'shipped'
  const trackingValid = trackingNumberPattern.test(trackingNumber.trim())
  const carrierNameValid = carrier !== 'other' || carrierName.trim().length > 0
  const shipment = needsShipment
    ? { carrier, trackingNumber: trackingNumber.trim(), ...(carrier === 'other' ? { carrierName: carrierName.trim() } : {}) }
    : undefined
  const reasonInvalid = kind === 'cancelReceipt' && receiptReason.trim().length === 0
  const command: OrderCommand = kind === 'fulfillment' ? { kind, status: nextStatus ?? 'processing', ...(shipment ? { shipment } : {}) }
    : kind === 'collectCod' ? { kind, amountSatang: totalSatang }
      : kind === 'cancelReceipt' ? { kind, reason: receiptReason.trim() }
      : kind === 'reissue' || kind === 'revoke' ? { kind, reasonCode }
        : { kind }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{titles[kind]}?</DialogTitle><DialogDescription>{kind === 'cancel' ? 'การยกเลิกจะคืนสต็อกที่จัดสรรไว้ หากรับเงิน Stripe แล้ว ต้องขอคืนเงินแยกต่างหาก' : kind === 'refund' ? 'ระบบจะส่งคำขอคืนเงินเต็มจำนวนไปยัง Stripe; สถานะสำเร็จจะแสดงเมื่อผู้ให้บริการยืนยัน' : kind === 'collectCod' ? 'ยืนยันยอดรับชำระเท่ากับยอดคำสั่งซื้อพอดี' : kind === 'issueReceipt' ? 'ระบบจะออกใบเสร็จตามข้อมูลผู้ขายในหน้า Settings' : kind === 'cancelReceipt' ? 'ใบเสร็จจะถูกทำเครื่องหมายยกเลิก และเลขที่ใบเสร็จจะไม่ถูกใช้ซ้ำ' : 'ตรวจสอบสถานะคำสั่งซื้อก่อนยืนยันการดำเนินการ'}</DialogDescription></DialogHeader>
    {(kind === 'reissue' || kind === 'revoke') && <label className="grid gap-2 text-sm">เหตุผล<select className="h-10 rounded-md border bg-background px-3" value={reasonCode} onChange={event => setReasonCode(event.target.value as typeof reasonCode)}><option value="support_recovery">ช่วยเหลือการเข้าถึง</option><option value="customer_request">ลูกค้าร้องขอ</option><option value="suspected_compromise">สงสัยว่าบัญชีถูกเข้าถึง</option></select></label>}
    {kind === 'cancelReceipt' && <label className="grid gap-2 text-sm">เหตุผลในการยกเลิกใบเสร็จ<Textarea value={receiptReason} maxLength={300} aria-invalid={reasonInvalid} onChange={event => setReceiptReason(event.target.value)} /></label>}
    {needsShipment && <div className="grid gap-4">
      <label className="grid gap-2 text-sm">ขนส่ง<select className="h-10 rounded-md border bg-background px-3" value={carrier} onChange={event => setCarrier(event.target.value as Carrier)}>{Object.entries(carrierLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {carrier === 'other' && <label className="grid gap-2 text-sm">ชื่อขนส่ง<input className="h-10 rounded-md border bg-background px-3" value={carrierName} maxLength={80} aria-invalid={!carrierNameValid} onChange={event => setCarrierName(event.target.value)} /></label>}
      <label className="grid gap-2 text-sm">เลขพัสดุ<input className="h-10 rounded-md border bg-background px-3 font-mono" value={trackingNumber} maxLength={40} autoComplete="off" aria-invalid={trackingNumber.length > 0 && !trackingValid} aria-describedby="tracking-help" onChange={event => setTrackingNumber(event.target.value)} /><span id="tracking-help" className="text-xs text-muted-foreground">ตัวอักษรภาษาอังกฤษ ตัวเลข หรือขีด 4–40 ตัว</span></label>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{uncertain && <p role="status" className="text-sm text-muted-foreground">ยังยืนยันผลไม่ได้ กรุณาส่งคำขอเดิมซ้ำเพื่อกู้สถานะ</p>}
    <DialogFooter><Button variant="outline" disabled={pending || uncertain} onClick={() => onOpenChange(false)}>ปิด</Button>{uncertain ? <Button disabled={pending} onClick={onRetry}>{pending ? 'กำลังตรวจสอบ...' : 'ส่งคำขอเดิมซ้ำ'}</Button> : <Button disabled={pending || (needsShipment && (!trackingValid || !carrierNameValid)) || reasonInvalid} onClick={() => onSubmit(command)}>{pending ? 'กำลังบันทึก...' : 'ยืนยัน'}</Button>}</DialogFooter>
  </DialogContent></Dialog>
}
