import { asc, eq } from 'drizzle-orm'
import type { DatabaseTransaction } from '../../database/types'
import { commerceOrder, orderItem } from '../../database/schema'
import { DomainError } from '../../shared/domain-error'
import type { OrderItemSnapshot, OrderSnapshot } from './types'

export async function readOrderSnapshot(tx: DatabaseTransaction, orderId: string): Promise<OrderSnapshot> {
  const [order] = await tx.select().from(commerceOrder).where(eq(commerceOrder.id, orderId)).limit(1)
  if (!order) throw new DomainError('INVALID_ORDER_COMMAND')
  const itemRows = await tx.select().from(orderItem)
    .where(eq(orderItem.orderId, orderId))
    .orderBy(asc(orderItem.createdAt), asc(orderItem.id))
  const items: OrderItemSnapshot[] = itemRows.map((item) => ({
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    sku: item.sku,
    productName: item.productName,
    variantName: item.variantName,
    unit: item.unit,
    unitPriceSatang: item.unitPriceSatang,
    quantity: item.quantity,
    lineTotalSatang: item.lineTotalSatang,
  }))
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customerId: order.customerId,
    contactEmail: order.contactEmail,
    contactPhone: order.contactPhone,
    recipientName: order.recipientName,
    addressLine1: order.addressLine1,
    addressLine2: order.addressLine2,
    subdistrict: order.subdistrict,
    district: order.district,
    province: order.province,
    postalCode: order.postalCode,
    subtotalSatang: order.subtotalSatang,
    shippingSatang: order.shippingSatang,
    totalSatang: order.totalSatang,
    currency: 'THB',
    paymentMethod: 'cod',
    createdAt: order.createdAt.toISOString(),
    items,
  }
}
