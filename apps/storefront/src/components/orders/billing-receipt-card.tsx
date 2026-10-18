import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Download04Icon } from '@hugeicons/core-free-icons'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { AddressText } from '@/pages/account/account-ui'
import { isSameContactAddress } from '@/pages/account/order-display'
import type { StoreOrderDetail } from '@/lib/store-orders'
import { ButtonSpinner } from '@/components/loading/button-spinner'

type Billing = NonNullable<StoreOrderDetail['billing']>
type Receipt = NonNullable<StoreOrderDetail['receipt']>

export function ReceiptDownloadButton({ receipt, download, variant = 'outline' }: { receipt: Receipt; download: (fileName: string) => Promise<void>; variant?: 'outline' | 'secondary' }) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function run() {
    setPending(true)
    setFailed(false)
    try { await download(`${receipt.number}.pdf`) } catch { setFailed(true) } finally { setPending(false) }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant={variant} disabled={pending} onClick={() => void run()}>
        {pending ? <ButtonSpinner show /> : <HugeiconsIcon icon={Download04Icon} strokeWidth={2} data-icon="inline-start" />}
        ดาวน์โหลดใบเสร็จ
      </Button>
      {failed && <p role="alert" className="text-sm text-destructive">ดาวน์โหลดใบเสร็จไม่สำเร็จ ลองอีกครั้ง</p>}
    </div>
  )
}

// Without `download`, the card only describes the receipt; the caller places the download action elsewhere.
export function BillingReceiptCard({ billing, receipt, download, shipping }: {
  billing?: Billing | null
  receipt?: Receipt | null
  download?: (fileName: string) => Promise<void>
  shipping?: Billing
}) {
  if (!billing && !receipt) return null
  const sameAsShipping = Boolean(billing && shipping && isSameContactAddress(billing, shipping))

  return (
    <Card>
      <CardHeader><CardTitle role="heading" aria-level={3} className="text-lg font-semibold">ใบเสร็จ</CardTitle></CardHeader>
      <CardContent className="gap-4 leading-7">
        {billing && <div>
          <p className="text-sm text-muted-foreground">ที่อยู่ออกใบเสร็จ</p>
          {sameAsShipping
            ? <p>ใช้ชื่อและที่อยู่เดียวกับที่จัดส่ง</p>
            : <>
              <p className="font-medium">{billing.name}</p>
              <p className="text-muted-foreground">{billing.phone}</p>
              <p className="text-muted-foreground"><AddressText address={billing} /></p>
            </>}
        </div>}
        {receipt && <div className="flex flex-col items-start gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">เลขที่ใบเสร็จ <span className="font-mono font-medium text-foreground">{receipt.number}</span></p>
          {receipt.status === 'cancelled' && <Badge variant="destructive">ใบเสร็จถูกยกเลิก</Badge>}
          {download && <ReceiptDownloadButton receipt={receipt} download={download} />}
        </div>}
      </CardContent>
    </Card>
  )
}
