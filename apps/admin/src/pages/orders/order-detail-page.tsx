import { Link, useParams } from 'react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { QueryState } from '@/components/query-state'
import { isUuid } from '@/lib/ids'
import { authSessionQuery } from '@/lib/auth-session'
import { useOrderCommand } from '@/hooks/use-order-command'
import { availableOrderCommands, nextFulfillmentStatus } from '@/lib/orders/eligibility'
import { orderQuery } from '@/lib/orders/queries'
import { OrderDetailSummary } from './_components/order-detail-summary'
import { OrderCommandDialog } from './_components/order-command-dialog'

export function Component() {
  const { orderId = '' } = useParams()
  const valid = isUuid(orderId)
  const session = useQuery(authSessionQuery)
  const order = useQuery({
    ...orderQuery(orderId),
    enabled: valid,
    refetchInterval: query => {
      const current = query.state.data
      return current && (current.status === 'pending_payment' || ['pending', 'requires_action'].includes(current.payment.refund?.status ?? '')) ? 5000 : false
    },
    refetchIntervalInBackground: false,
  })
  const staffId = session.data?.user.id ?? ''
  const command = useOrderCommand({ staffId, orderId })
  const [activeKind, setActiveKind] = useState<ReturnType<typeof availableOrderCommands>[number] | null>(null)
  const [copyMessage, setCopyMessage] = useState('')
  const permissions = session.data?.staff?.permissions ?? []
  if (!valid) return <section className="px-4 lg:px-6"><QueryState kind="not-found" message="รหัสคำสั่งซื้อไม่ถูกต้อง" /></section>
  if (order.isPending) return <section className="px-4 lg:px-6"><QueryState kind="loading" /></section>
  if (order.isError || !order.data) return <section className="px-4 lg:px-6"><QueryState kind={order.error && 'status' in order.error && order.error.status === 404 ? 'not-found' : 'error'} message="โหลดคำสั่งซื้อไม่ได้" onRetry={() => void order.refetch()} /></section>
  const available = availableOrderCommands(order.data, permissions)
  const canOpenCommand = (kind: typeof activeKind) => {
    if (command.isPending || command.uncertain || !kind) return
    setActiveKind(kind)
  }
  async function copyOrderId() {
    try { await navigator.clipboard.writeText(order.data!.id); setCopyMessage('คัดลอกรหัสคำสั่งซื้อแล้ว') }
    catch { setCopyMessage('คัดลอกรหัสไม่ได้ กรุณาคัดลอกจากรายละเอียด') }
  }
  return <section className="flex flex-col gap-6 px-4 lg:px-6"><div><Link className={buttonVariants({ variant: 'outline', size: 'sm' })} to="/orders">กลับรายการคำสั่งซื้อ</Link><p className="mt-5 text-sm text-muted-foreground">คำสั่งซื้อ</p><h1 className="text-3xl font-semibold tracking-tight">{order.data.orderNumber}</h1><p className="mt-1 text-sm text-muted-foreground">{order.data.status}</p><div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => void order.refetch()}>รีเฟรชสถานะ</Button><Button variant="outline" onClick={() => void copyOrderId()}>คัดลอกรหัสคำสั่งซื้อ</Button>{available.map(kind => <Button key={kind} disabled={command.isPending || command.uncertain || command.reviewRequired} onClick={() => canOpenCommand(kind)}>{kind === 'fulfillment' ? `ถัดไป: ${nextFulfillmentStatus(order.data)}` : ({ cancel: 'ยกเลิก', collectCod: 'รับเงินปลายทาง', refund: 'คืนเงิน', reissue: 'ส่งลิงก์ใหม่', revoke: 'เพิกถอนลิงก์' } as const)[kind]}</Button>)}</div>{copyMessage && <p role="status" className="mt-2 text-sm text-muted-foreground">{copyMessage}</p>}{command.uncertain && <div className="mt-3 flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">คำสั่งล่าสุดยังไม่ยืนยัน กรุณากู้ผลคำสั่งเดิมก่อนดำเนินการใหม่</p><Button variant="outline" onClick={() => command.pendingCommand && setActiveKind(command.pendingCommand)}>กู้คำสั่งเดิม</Button></div>}{command.uncertain && !command.storageAvailable && <p role="alert" className="text-sm text-destructive">sessionStorage ใช้งานไม่ได้; อย่าปิดหรือออกจากหน้านี้จนกว่าจะยืนยันผลคำสั่ง</p>}{command.reviewRequired && <div className="mt-3 flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">คำสั่งถูกปฏิเสธเพราะสถานะเปลี่ยน ตรวจสอบข้อมูลล่าสุดก่อนทำรายการใหม่</p><Button variant="outline" onClick={command.acknowledgeReview}>ตรวจสอบแล้ว</Button></div>}</div><OrderDetailSummary order={order.data} /><OrderCommandDialog open={Boolean(activeKind)} kind={activeKind} totalSatang={order.data.totalSatang} nextStatus={nextFulfillmentStatus(order.data)} pending={command.isPending} uncertain={command.uncertain} error={command.error} onOpenChange={open => { if (!open && !command.uncertain && !command.isPending) setActiveKind(null) }} onSubmit={value => { void command.submit(value).then(result => { if (result) setActiveKind(null) }) }} onRetry={() => { void command.retry().then(result => { if (result) setActiveKind(null) }) }} /></section>
}
