import { and, asc, desc, eq, notInArray, sql } from 'drizzle-orm'
import type { Database } from '../../database/types'
import { commerceOrder, customerAddress, user } from '../../database/schema'

type OrderStatus = typeof commerceOrder.$inferSelect['status']

// Orders that never became a sale: unpaid Stripe checkouts and cancellations.
const nonSaleStatuses: OrderStatus[] = ['pending_payment', 'cancelled']

export class AdminCustomerRepository {
  constructor(private readonly db: Database) {}

  async findCustomer(customerId: string) {
    const [row] = await this.db.select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      banned: user.banned,
      createdAt: user.createdAt,
    }).from(user)
      .where(and(eq(user.id, customerId), eq(user.accountType, 'customer')))
      .limit(1)
    return row as typeof row | undefined ?? null
  }

  async orderStats(customerId: string) {
    const [row] = await this.db.select({
      orderCount: sql<number>`count(*)`.mapWith(Number),
      spentSatang: sql<number>`coalesce(sum(${commerceOrder.totalSatang}) filter (where ${notInArray(commerceOrder.status, nonSaleStatuses)}), 0)`.mapWith(Number),
      lastOrderAt: sql<Date | null>`max(${commerceOrder.createdAt})`.mapWith(value => value === null ? null : new Date(value)),
    }).from(commerceOrder)
      .where(eq(commerceOrder.customerId, customerId))
    return row ?? { orderCount: 0, spentSatang: 0, lastOrderAt: null }
  }

  async addresses(customerId: string) {
    return this.db.select({
      id: customerAddress.id,
      label: customerAddress.label,
      recipientName: customerAddress.recipientName,
      phone: customerAddress.phone,
      addressLine1: customerAddress.addressLine1,
      addressLine2: customerAddress.addressLine2,
      subdistrict: customerAddress.subdistrict,
      district: customerAddress.district,
      province: customerAddress.province,
      postalCode: customerAddress.postalCode,
      isDefaultShipping: customerAddress.isDefaultShipping,
      isDefaultBilling: customerAddress.isDefaultBilling,
    }).from(customerAddress)
      .where(eq(customerAddress.userId, customerId))
      .orderBy(desc(customerAddress.isDefaultShipping), asc(customerAddress.createdAt), asc(customerAddress.id))
  }

  async recentOrders(customerId: string, limit: number) {
    return this.db.select({
      id: commerceOrder.id,
      orderNumber: commerceOrder.orderNumber,
      status: commerceOrder.status,
      paymentMethod: commerceOrder.paymentMethod,
      totalSatang: commerceOrder.totalSatang,
      createdAt: commerceOrder.createdAt,
    }).from(commerceOrder)
      .where(eq(commerceOrder.customerId, customerId))
      .orderBy(desc(commerceOrder.createdAt), desc(commerceOrder.id))
      .limit(limit)
  }
}
