import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert02Icon, Download04Icon, LinkSquare02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'
import { openReceipt, saveReceipt } from '@/lib/orders/api'
import { receiptPdfQuery } from '@/lib/orders/queries'

export interface ReceiptPreviewTarget {
  orderId: string
  number: string
  status: 'issued' | 'cancelled'
}

export function ReceiptPreviewDialog({ receipt, open, onOpenChange }: { receipt: ReceiptPreviewTarget; open: boolean; onOpenChange: (open: boolean) => void }) {
  const pdf = useQuery({ ...receiptPdfQuery(receipt.orderId, receipt.number, receipt.status), enabled: open })
  const blob = pdf.data
  // The frame owns its object URL: React 19 runs the returned cleanup when the frame unmounts or the blob changes.
  const frameRef = useCallback((frame: HTMLIFrameElement | null) => {
    if (!frame || !blob) return
    const url = URL.createObjectURL(blob)
    frame.src = url
    return () => URL.revokeObjectURL(url)
  }, [blob])

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[min(90dvh,60rem)] flex-col gap-4 sm:max-w-4xl">
      <DialogHeader className="pr-10">
        <DialogTitle>ใบเสร็จ <span className="font-mono">{receipt.number}</span></DialogTitle>
        <DialogDescription>{receipt.status === 'cancelled' ? 'ใบเสร็จนี้ถูกยกเลิกแล้ว' : 'ตัวอย่างใบเสร็จ PDF'}</DialogDescription>
      </DialogHeader>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-field border bg-muted">
        {pdf.isError
          ? <Alert variant="destructive" className="m-4 w-auto">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
            <AlertTitle>โหลดใบเสร็จไม่ได้</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <p role="alert">{pdf.error.message}</p>
              <Button variant="outline" size="sm" onClick={() => void pdf.refetch()}>ลองใหม่</Button>
            </AlertDescription>
          </Alert>
          : blob
            ? <iframe ref={frameRef} title={`ใบเสร็จ ${receipt.number}`} className="size-full" />
            : <div className="flex size-full items-center justify-center gap-2 text-muted-foreground"><Spinner />กำลังโหลดใบเสร็จ...</div>}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={!blob} onClick={() => blob && openReceipt(blob)}><HugeiconsIcon data-icon="inline-start" icon={LinkSquare02Icon} strokeWidth={2} />เปิดในแท็บใหม่</Button>
        <Button disabled={!blob} onClick={() => blob && saveReceipt(blob, receipt.number)}><HugeiconsIcon data-icon="inline-start" icon={Download04Icon} strokeWidth={2} />ดาวน์โหลด</Button>
      </div>
    </DialogContent>
  </Dialog>
}
