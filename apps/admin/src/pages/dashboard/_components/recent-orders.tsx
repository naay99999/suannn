import { Link } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@workspace/ui/components/table'
import { QueryState } from '@/components/query-state'
import type { DashboardOverview } from '@/lib/dashboard/api'
import { formatMoney, formatTimestamp } from '@/lib/format'

type OrderStatus = DashboardOverview['recentOrders'][number]['status']

const statusBadges: Record<OrderStatus, { label: string; variant: 'outline' | 'info' | 'warning' | 'success' | 'destructive' }> = {
  pending_payment: { label: 'รอชำระเงิน', variant: 'warning' },
  placed: { label: 'ใหม่', variant: 'info' },
  processing: { label: 'กำลังเตรียม', variant: 'info' },
  packed: { label: 'แพ็กแล้ว', variant: 'info' },
  shipped: { label: 'จัดส่งแล้ว', variant: 'outline' },
  delivered: { label: 'ส่งถึงแล้ว', variant: 'success' },
  cancelled: { label: 'ยกเลิก', variant: 'destructive' },
}

export function RecentOrders({ orders }: { orders: DashboardOverview['recentOrders'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>คำสั่งซื้อล่าสุด</CardTitle>
        <CardDescription>รายการที่เข้ามาใหม่ทุกสถานะ</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" render={<Link to="/orders" />} nativeButton={false}>ดูทั้งหมด</Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {orders.length === 0
          ? <QueryState kind="empty" message="ยังไม่มีคำสั่งซื้อ" />
          : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>คำสั่งซื้อ</TableHead>
                  <TableHead>ลูกค้า</TableHead>
                  <TableHead>วันที่</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="text-right">ยอดรวม</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/orders/${order.id}`}>{order.orderNumber}</Link>
                    </TableCell>
                    <TableCell>{order.recipientName}</TableCell>
                    <TableCell className="text-muted-foreground">{formatTimestamp(order.createdAt)}</TableCell>
                    <TableCell><Badge variant={statusBadges[order.status].variant}>{statusBadges[order.status].label}</Badge></TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatMoney(order.totalSatang)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </CardContent>
    </Card>
  )
}
