import { and, desc, gte, inArray, lt, notInArray, sql } from 'drizzle-orm'
import type { Database } from '../../database/types'
import { commerceOrder } from '../../database/schema'

type OrderStatus = typeof commerceOrder.$inferSelect['status']

// Orders that never became a sale: unpaid Stripe checkouts and cancellations.
const nonSaleStatuses: OrderStatus[] = ['pending_payment', 'cancelled']
export const backlogStatuses = ['pending_payment', 'placed', 'processing', 'packed'] as const satisfies OrderStatus[]

export interface DailySales {
  date: string
  orderCount: number
  revenueSatang: number
}

export class DashboardRepository {
  constructor(private readonly db: Database) {}

  // Groups sales by Asia/Bangkok calendar day within [from, to).
  async dailySales(from: Date, to: Date): Promise<DailySales[]> {
    const day = sql<string>`to_char(${commerceOrder.createdAt} at time zone 'Asia/Bangkok', 'YYYY-MM-DD')`
    return this.db.select({
      date: day,
      orderCount: sql<number>`count(*)`.mapWith(Number),
      revenueSatang: sql<number>`coalesce(sum(${commerceOrder.totalSatang}), 0)`.mapWith(Number),
    }).from(commerceOrder)
      .where(and(
        gte(commerceOrder.createdAt, from),
        lt(commerceOrder.createdAt, to),
        notInArray(commerceOrder.status, nonSaleStatuses),
      ))
      .groupBy(day)
  }

  async backlogCounts() {
    return this.db.select({
      status: commerceOrder.status,
      count: sql<number>`count(*)`.mapWith(Number),
    }).from(commerceOrder)
      .where(inArray(commerceOrder.status, [...backlogStatuses]))
      .groupBy(commerceOrder.status)
  }

  async recentOrders(limit: number) {
    return this.db.select({
      id: commerceOrder.id,
      orderNumber: commerceOrder.orderNumber,
      recipientName: commerceOrder.recipientName,
      status: commerceOrder.status,
      paymentMethod: commerceOrder.paymentMethod,
      totalSatang: commerceOrder.totalSatang,
      createdAt: commerceOrder.createdAt,
    }).from(commerceOrder)
      .orderBy(desc(commerceOrder.createdAt), desc(commerceOrder.id))
      .limit(limit)
  }
}
