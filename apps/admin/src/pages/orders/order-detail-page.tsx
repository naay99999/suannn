import { Link, useParams } from 'react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert02Icon, ArrowLeft01Icon, MoreHorizontalIcon, RefreshIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { cn } from '@workspace/ui/lib/utils'
import { CopyButton } from '@/components/copy-button'
import { QueryState } from '@/components/query-state'
import { isUuid } from '@/lib/ids'
import { authSessionQuery } from '@/lib/auth-session'
import { useOrderCommand } from '@/hooks/use-order-command'
import type { OrderCommand, OrderDetail } from '@/lib/orders/api'
import { availableOrderCommands, nextFulfillmentStatus } from '@/lib/orders/eligibility'
import { commandLabels, fulfillmentActionLabels, fulfillmentSteps, orderStatusLabels, paymentMethodLabels, paymentStatusLabels } from '@/lib/orders/labels'
import { ordersApi } from '@/lib/orders/api'
import { orderQuery } from '@/lib/orders/queries'
import { formatMoney, formatTimestamp } from '@/lib/format'
import { OrderDetailSummary } from './_components/order-detail-summary'
import { OrderCommandDialog } from './_components/order-command-dialog'
import { ReceiptPreviewDialog } from './_components/receipt-preview-dialog'

type CommandKind = OrderCommand['kind']

// Money-moving and status-advancing commands stay visible; rarely used or destructive ones live in the overflow menu.
const visibleCommands: Exclude<CommandKind, 'fulfillment'>[] = ['collectCod', 'issueReceipt', 'refund']
const menuCommands: Exclude<CommandKind, 'fulfillment'>[] = ['reissue', 'revoke', 'cancelReceipt']

function FulfillmentProgress({ order }: { order: OrderDetail }) {
  if (order.status === 'cancelled') return <Alert variant="destructive"><HugeiconsIcon icon={Alert02Icon} strokeWidth={2} /><AlertTitle>คำสั่งซื้อนี้ถูกยกเลิกแล้ว</AlertTitle><AlertDescription>สต็อกที่จัดสรรไว้ถูกคืนแล้ว หากรับชำระผ่าน Stripe ให้ตรวจสอบการคืนเงินในส่วนการชำระเงิน</AlertDescription></Alert>
  if (order.status === 'pending_payment') return <Alert><HugeiconsIcon icon={Alert02Icon} strokeWidth={2} /><AlertTitle>รอลูกค้าชำระเงิน</AlertTitle><AlertDescription>หน้านี้จะอัปเดตอัตโนมัติเมื่อได้รับการชำระเงิน</AlertDescription></Alert>
  const current = fulfillmentSteps.findIndex(step => step.status === order.status)
  return <nav aria-label="ความคืบหน้าการจัดส่ง">
    <ol className="grid grid-cols-5 gap-2">
      {fulfillmentSteps.map((step, index) => {
        const done = index <= current
        return <li key={step.status} aria-current={index === current ? 'step' : undefined} className="flex flex-col gap-2">
          <span className={cn('h-1.5 rounded-pill transition-colors', done ? 'bg-primary' : 'bg-muted')} />
          <span className={cn('flex items-center gap-1 text-xs', index === current ? 'font-medium text-foreground' : done ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
            {index < current && <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-3 shrink-0" />}
            <span className="truncate">{step.label}</span>
          </span>
        </li>
      })}
    </ol>
  </nav>
}

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
  const [activeKind, setActiveKind] = useState<CommandKind | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [downloadState, setDownloadState] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null })
  const permissions = session.data?.staff?.permissions ?? []
  if (!valid) return <section className="px-4 lg:px-6"><QueryState kind="not-found" message="รหัสคำสั่งซื้อไม่ถูกต้อง" /></section>
  if (order.isPending) return <section className="px-4 lg:px-6"><QueryState kind="loading" /></section>
  if (order.isError || !order.data) return <section className="px-4 lg:px-6"><QueryState kind={order.error && 'status' in order.error && order.error.status === 404 ? 'not-found' : 'error'} message="โหลดคำสั่งซื้อไม่ได้" onRetry={() => void order.refetch()} /></section>
  const data = order.data
  const available = availableOrderCommands(data, permissions)
  const nextStatus = nextFulfillmentStatus(data)
  const blocked = command.isPending || command.uncertain || command.reviewRequired
  const status = orderStatusLabels[data.status]
  const payment = paymentStatusLabels[data.payment.status]
  const primary = available.includes('fulfillment') && nextStatus ? 'fulfillment' : null
  const secondary = visibleCommands.filter(kind => available.includes(kind))
  const overflow = menuCommands.filter(kind => available.includes(kind))
  const canCancel = available.includes('cancel')
  const openCommand = (kind: CommandKind) => {
    if (command.isPending || command.uncertain) return
    setActiveKind(kind)
  }
  async function downloadReceipt() {
    const number = data.receipt?.number
    if (!number || downloadState.pending) return
    setDownloadState({ pending: true, error: null })
    try { await ordersApi.downloadReceipt(orderId, number); setDownloadState({ pending: false, error: null }) }
    catch (error) { setDownloadState({ pending: false, error: error instanceof Error ? error.message : 'ดาวน์โหลดใบเสร็จไม่ได้' }) }
  }

  return <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 lg:px-6">
    <header className="flex flex-col gap-5">
      <Link className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2 w-fit text-muted-foreground')} to="/orders"><HugeiconsIcon data-icon="inline-start" icon={ArrowLeft01Icon} strokeWidth={2} />กลับรายการคำสั่งซื้อ</Link>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{data.orderNumber}</h1>
            <CopyButton value={data.id} label="คัดลอกรหัสคำสั่งซื้อ" copiedMessage="คัดลอกรหัสคำสั่งซื้อแล้ว" />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={status.tone}>{status.label}</Badge>
            <Badge variant={payment.tone}>{paymentMethodLabels[data.paymentMethod]} · {payment.label}</Badge>
            <span className="tabular-nums">{formatMoney(data.totalSatang)}</span>
            <span aria-hidden="true">·</span>
            <span>สั่งเมื่อ {formatTimestamp(data.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" aria-label="รีเฟรชสถานะ" title="รีเฟรชสถานะ" disabled={order.isFetching} onClick={() => void order.refetch()}><HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className={cn(order.isFetching && 'animate-spin')} /></Button>
          {(overflow.length > 0 || canCancel) && <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="การดำเนินการอื่น" disabled={blocked} />}><HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {overflow.length > 0 && <DropdownMenuGroup>{overflow.map(kind => <DropdownMenuItem key={kind} variant={kind === 'reissue' ? 'default' : 'destructive'} onClick={() => openCommand(kind)}>{commandLabels[kind]}</DropdownMenuItem>)}</DropdownMenuGroup>}
              {overflow.length > 0 && canCancel && <DropdownMenuSeparator />}
              {canCancel && <DropdownMenuGroup><DropdownMenuItem variant="destructive" onClick={() => openCommand('cancel')}>{commandLabels.cancel}</DropdownMenuItem></DropdownMenuGroup>}
            </DropdownMenuContent>
          </DropdownMenu>}
          {secondary.map(kind => <Button key={kind} variant={primary ? 'outline' : 'default'} disabled={blocked} onClick={() => openCommand(kind)}>{commandLabels[kind]}</Button>)}
          {primary && nextStatus && <Button disabled={blocked} onClick={() => openCommand('fulfillment')}>{fulfillmentActionLabels[nextStatus]}</Button>}
        </div>
      </div>
      <FulfillmentProgress order={data} />
    </header>

    {command.uncertain && <Alert variant="destructive">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
      <AlertTitle>คำสั่งล่าสุดยังไม่ยืนยัน</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p role="alert">กรุณากู้ผลคำสั่งเดิมก่อนดำเนินการใหม่</p>
        {!command.storageAvailable && <p role="alert">sessionStorage ใช้งานไม่ได้; อย่าปิดหรือออกจากหน้านี้จนกว่าจะยืนยันผลคำสั่ง</p>}
        <Button variant="outline" size="sm" onClick={() => command.pendingCommand && setActiveKind(command.pendingCommand)}>กู้คำสั่งเดิม</Button>
      </AlertDescription>
    </Alert>}
    {command.reviewRequired && <Alert variant="destructive">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
      <AlertTitle>สถานะคำสั่งซื้อเปลี่ยนไป</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p role="alert">คำสั่งถูกปฏิเสธเพราะสถานะเปลี่ยน ตรวจสอบข้อมูลล่าสุดก่อนทำรายการใหม่</p>
        <Button variant="outline" size="sm" onClick={command.acknowledgeReview}>ตรวจสอบแล้ว</Button>
      </AlertDescription>
    </Alert>}
    {downloadState.error && <p role="alert" className="text-sm text-destructive">{downloadState.error}</p>}

    <OrderDetailSummary order={data} customerHref={data.customerId && permissions.includes('customer:read') ? `/customers/${encodeURIComponent(data.customerId)}` : undefined} onViewReceipt={() => setReceiptOpen(true)} onDownloadReceipt={() => void downloadReceipt()} downloadPending={downloadState.pending} />
    {data.receipt && <ReceiptPreviewDialog receipt={{ orderId, number: data.receipt.number, status: data.receipt.status }} open={receiptOpen} onOpenChange={setReceiptOpen} />}
    <OrderCommandDialog open={Boolean(activeKind)} kind={activeKind} totalSatang={data.totalSatang} nextStatus={nextStatus} pending={command.isPending} uncertain={command.uncertain} error={command.error} onOpenChange={open => { if (!open && !command.uncertain && !command.isPending) setActiveKind(null) }} onSubmit={value => { void command.submit(value).then(result => { if (result) setActiveKind(null) }) }} onRetry={() => { void command.retry().then(result => { if (result) setActiveKind(null) }) }} />
  </section>
}
