import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import type { OrderCommand } from '@/lib/orders/api'

const titles: Record<OrderCommand['kind'], string> = { fulfillment: 'อัปเดตการจัดส่ง', cancel: 'ยกเลิกคำสั่งซื้อ', collectCod: 'บันทึกรับเงินปลายทาง', refund: 'ขอคืนเงินเต็มจำนวน', reissue: 'ส่งลิงก์ติดตามใหม่', revoke: 'เพิกถอนลิงก์ติดตาม' }

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
  if (!kind) return null
  const command: OrderCommand = kind === 'fulfillment' ? { kind, status: nextStatus ?? 'processing' }
    : kind === 'collectCod' ? { kind, amountSatang: totalSatang }
      : kind === 'reissue' || kind === 'revoke' ? { kind, reasonCode }
        : { kind }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{titles[kind]}?</DialogTitle><DialogDescription>{kind === 'cancel' ? 'การยกเลิกจะคืนสต็อกที่จัดสรรไว้ หากรับเงิน Stripe แล้ว ต้องขอคืนเงินแยกต่างหาก' : kind === 'refund' ? 'ระบบจะส่งคำขอคืนเงินเต็มจำนวนไปยัง Stripe; สถานะสำเร็จจะแสดงเมื่อผู้ให้บริการยืนยัน' : kind === 'collectCod' ? 'ยืนยันยอดรับชำระเท่ากับยอดคำสั่งซื้อพอดี' : 'ตรวจสอบสถานะคำสั่งซื้อก่อนยืนยันการดำเนินการ'}</DialogDescription></DialogHeader>
    {(kind === 'reissue' || kind === 'revoke') && <label className="grid gap-2 text-sm">เหตุผล<select className="h-10 rounded-md border bg-background px-3" value={reasonCode} onChange={event => setReasonCode(event.target.value as typeof reasonCode)}><option value="support_recovery">ช่วยเหลือการเข้าถึง</option><option value="customer_request">ลูกค้าร้องขอ</option><option value="suspected_compromise">สงสัยว่าบัญชีถูกเข้าถึง</option></select></label>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{uncertain && <p role="status" className="text-sm text-muted-foreground">ยังยืนยันผลไม่ได้ กรุณาส่งคำขอเดิมซ้ำเพื่อกู้สถานะ</p>}
    <DialogFooter><Button variant="outline" disabled={pending || uncertain} onClick={() => onOpenChange(false)}>ปิด</Button>{uncertain ? <Button disabled={pending} onClick={onRetry}>{pending ? 'กำลังตรวจสอบ...' : 'ส่งคำขอเดิมซ้ำ'}</Button> : <Button disabled={pending} onClick={() => onSubmit(command)}>{pending ? 'กำลังบันทึก...' : 'ยืนยัน'}</Button>}</DialogFooter>
  </DialogContent></Dialog>
}
