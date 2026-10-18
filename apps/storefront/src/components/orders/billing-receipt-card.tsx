import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Download04Icon } from '@hugeicons/core-free-icons'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { AddressText } from '@/pages/account/account-ui'
import type { StoreOrderDetail } from '@/lib/store-orders'

type Billing = NonNullable<StoreOrderDetail['billing']>
type Receipt = NonNullable<StoreOrderDetail['receipt']>

export function BillingReceiptCard({ billing, receipt, download }: { billing?: Billing | null; receipt?: Receipt | null; download: (fileName: string) => Promise<void> }) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!billing && !receipt) return null

  async function run() {
    if (!receipt) return
    setPending(true)
    setFailed(false)
    try { await download(`${receipt.number}.pdf`) } catch { setFailed(true) } finally { setPending(false) }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">ที่อยู่ออกใบเสร็จ</CardTitle></CardHeader>
      <CardContent className="gap-4 leading-7">
        {billing && <div>
          <p className="font-medium">{billing.name}</p>
          <p className="text-muted-foreground">{billing.phone}</p>
          <p className="text-muted-foreground"><AddressText address={billing} /></p>
        </div>}
        {receipt && <div className="flex flex-col items-start gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">เลขที่ใบเสร็จ <span className="font-mono font-medium text-foreground">{receipt.number}</span></p>
          {receipt.status === 'cancelled' && <Badge variant="destructive">ใบเสร็จถูกยกเลิก</Badge>}
          <Button type="button" variant="outline" disabled={pending} onClick={() => void run()}>
            <HugeiconsIcon icon={Download04Icon} strokeWidth={2} data-icon="inline-start" />
            ดาวน์โหลดใบเสร็จ
          </Button>
          {failed && <p role="alert" className="text-sm text-destructive">ดาวน์โหลดใบเสร็จไม่สำเร็จ ลองอีกครั้ง</p>}
        </div>}
      </CardContent>
    </Card>
  )
}
