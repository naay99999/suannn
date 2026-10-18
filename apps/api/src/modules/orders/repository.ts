import { and, asc, desc, eq, gt, isNotNull, lt, or, sql } from 'drizzle-orm'
import type { DatabaseTransaction } from '../../database/types'
import { commerceOrder, orderItem, payment, stripeCheckoutAttempt, stripeRefund } from '../../database/schema'
import { DomainError } from '../../shared/domain-error'
import { encodeCursor, decodeCursor } from '../../shared/cursor'
import type { OrderDetail, OrderItemSnapshot, OrderPage, OrderShipment, OrderSnapshot } from './types'

export async function readOrderSnapshot(tx: DatabaseTransaction, orderId: string): Promise<OrderSnapshot> {
  return (await loadOrder(tx, orderId)).snapshot
}

function shipmentOf(order: typeof commerceOrder.$inferSelect): OrderShipment | null {
  if (!order.shipmentCarrier || !order.trackingNumber || !order.shippedAt) return null
  return {
    carrier: order.shipmentCarrier,
    carrierName: order.shipmentCarrierName,
    trackingNumber: order.trackingNumber,
    shippedAt: order.shippedAt.toISOString(),
  }
}

async function loadOrder(tx: DatabaseTransaction, orderId: string) {
  const [order] = await tx.select().from(commerceOrder).where(eq(commerceOrder.id, orderId)).limit(1)
  if (!order) throw new DomainError('ORDER_NOT_FOUND')
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
    vatTreatment: item.vatTreatment,
  }))
  const snapshot: OrderSnapshot = {
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
    billing: {
      name: order.billingName,
      phone: order.billingPhone,
      addressLine1: order.billingAddressLine1,
      addressLine2: order.billingAddressLine2,
      subdistrict: order.billingSubdistrict,
      district: order.billingDistrict,
      province: order.billingProvince,
      postalCode: order.billingPostalCode,
    },
    subtotalSatang: order.subtotalSatang,
    shippingSatang: order.shippingSatang,
    totalSatang: order.totalSatang,
    currency: 'THB',
    paymentMethod: order.paymentMethod as OrderSnapshot['paymentMethod'],
    createdAt: order.createdAt.toISOString(),
    items,
  }
  return { snapshot, shipment: shipmentOf(order) }
}

export async function readGuestOrderAccessRecord(tx: DatabaseTransaction, orderId: string) {
  const [order] = await tx.select({
    id: commerceOrder.id,
    customerId: commerceOrder.customerId,
    guestAccessTokenHash: commerceOrder.guestAccessTokenHash,
    terminalAt: commerceOrder.terminalAt,
  }).from(commerceOrder).where(eq(commerceOrder.id, orderId)).limit(1)
  return order ?? null
}

export async function lockOrder(tx: DatabaseTransaction, orderId: string) {
  const [order] = await tx.select().from(commerceOrder)
    .where(eq(commerceOrder.id, orderId)).for('update').limit(1)
  if (!order) throw new DomainError('ORDER_NOT_FOUND')
  return order
}

export async function readOrderDetail(tx: DatabaseTransaction, orderId: string): Promise<OrderDetail> {
  const { snapshot: order, shipment } = await loadOrder(tx, orderId)
  const [savedPayment] = await tx.select({
    id: payment.id,
    method: payment.method,
    provider: payment.provider,
    amountSatang: payment.amountSatang,
    currency: payment.currency,
    status: payment.status,
  }).from(payment).where(eq(payment.orderId, orderId)).limit(1)
  if (!savedPayment) throw new DomainError('ORDER_PAYMENT_CONFLICT')
  const [refund] = await tx.select({
    id: stripeRefund.id,
    amountSatang: stripeRefund.amountSatang,
    status: stripeRefund.status,
    createdAt: stripeRefund.createdAt,
    updatedAt: stripeRefund.updatedAt,
  }).from(stripeRefund).where(eq(stripeRefund.paymentId, savedPayment.id))
    .orderBy(desc(stripeRefund.createdAt), desc(stripeRefund.id)).limit(1)
  return {
    ...order,
    ...(shipment ? { shipment } : {}),
    payment: {
      ...savedPayment,
      currency: 'THB',
      ...(refund ? {
        refund: {
          ...refund,
          createdAt: refund.createdAt.toISOString(),
          updatedAt: refund.updatedAt.toISOString(),
        },
      } : {}),
    },
  }
}

// Returns the hosted Stripe Checkout session a customer can still return to, if any.
export async function readOpenStripeCheckout(tx: DatabaseTransaction, orderId: string) {
  const [attempt] = await tx.select({ url: stripeCheckoutAttempt.checkoutUrl, expiresAt: stripeCheckoutAttempt.expiresAt })
    .from(stripeCheckoutAttempt)
    .where(and(
      eq(stripeCheckoutAttempt.orderId, orderId),
      eq(stripeCheckoutAttempt.status, 'open'),
      isNotNull(stripeCheckoutAttempt.checkoutUrl),
      gt(stripeCheckoutAttempt.expiresAt, sql`transaction_timestamp()`),
    )).limit(1)
  if (!attempt?.url || !attempt.expiresAt) return null
  return { url: attempt.url, expiresAt: attempt.expiresAt.toISOString() }
}

export async function listOrderDetails(
  tx: DatabaseTransaction,
  query: { customerId?: string; cursor?: string; limit: number },
): Promise<OrderPage> {
  const cursor = decodeCursor(query.cursor, ['createdAt', 'id'])
  const rows = await tx.select({ id: commerceOrder.id, createdAt: commerceOrder.createdAt })
    .from(commerceOrder).where(and(
      query.customerId ? eq(commerceOrder.customerId, query.customerId) : undefined,
      cursor ? or(
        lt(commerceOrder.createdAt, new Date(cursor.createdAt)),
        and(eq(commerceOrder.createdAt, new Date(cursor.createdAt)), lt(commerceOrder.id, cursor.id)),
      ) : undefined,
    )).orderBy(desc(commerceOrder.createdAt), desc(commerceOrder.id)).limit(query.limit + 1)
  const hasMore = rows.length > query.limit
  const pageRows = rows.slice(0, query.limit)
  const items: OrderDetail[] = []
  for (const row of pageRows) items.push(await readOrderDetail(tx, row.id))
  const last = pageRows.at(-1)
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  }
}
