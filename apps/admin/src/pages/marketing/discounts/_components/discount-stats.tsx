import { Link } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { formatMoney, formatTimestamp } from '@/lib/format'
import type { DiscountDetail } from '@/lib/discounts/api'
import { discountStatusLabels, discountUsesText } from '@/lib/discounts/labels'

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return <Card size="sm"><CardHeader><CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="text-xl font-semibold tabular-nums">{children}</CardContent></Card>
}

export function DiscountStats({ discount }: { discount: DiscountDetail }) {
  const status = discountStatusLabels[discount.status]
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="สถานะ"><Badge variant={status.tone}>{status.label}</Badge></Stat>
        <Stat label="ใช้แล้ว">{discountUsesText(discount)}</Stat>
        <Stat label="ยอดขายจากโค้ดนี้">{formatMoney(discount.revenueSatang)}</Stat>
        <Stat label="ส่วนลดที่ให้ไปแล้ว">{formatMoney(discount.discountGivenSatang)}</Stat>
      </div>
      <Card>
        <CardHeader><CardTitle>คำสั่งซื้อล่าสุดที่ใช้โค้ดนี้</CardTitle></CardHeader>
        <CardContent>
          {discount.recentOrders.length === 0
            ? <p className="text-sm text-muted-foreground">ยังไม่มีคำสั่งซื้อที่ใช้โค้ดนี้</p>
            : <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เลขที่คำสั่งซื้อ</TableHead>
                  <TableHead>วันที่</TableHead>
                  <TableHead className="text-right">ยอดรวม</TableHead>
                  <TableHead className="text-right">ส่วนลด</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {discount.recentOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell><Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/orders/${order.id}`}>{order.orderNumber}</Link></TableCell>
                    <TableCell>{formatTimestamp(order.createdAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(order.totalSatang)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(order.discountSatang)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>}
        </CardContent>
      </Card>
    </div>
  )
}
