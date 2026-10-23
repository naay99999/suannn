import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm'
import type { DatabaseTransaction } from '../../database/types'
import { commerceOrder, orderItem, payment, receipt, stripeCheckoutAttempt, stripeRefund } from '../../database/schema'
import { DomainError } from '../../shared/domain-error'
import { encodeCursor, decodeCursor } from '../../shared/cursor'
import type { OrderDetail, OrderPage, OrderReceiptSummary, OrderShipment, OrderSnapshot, OrderSort, OrderSortField } from './types'

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

type OrderRow = typeof commerceOrder.$inferSelect
type OrderItemRow = typeof orderItem.$inferSelect

function orderSnapshotOf(order: OrderRow, itemRows: OrderItemRow[]): OrderSnapshot {
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
    discount: order.discountCode && order.discountKind
      ? {
        code: order.discountCode,
        kind: order.discountKind,
        itemDiscountSatang: order.discountSatang,
        shippingDiscountSatang: order.shippingDiscountSatang,
      }
      : null,
    currency: 'THB',
    paymentMethod: order.paymentMethod as OrderSnapshot['paymentMethod'],
    createdAt: order.createdAt.toISOString(),
    items: itemRows.map((item) => ({
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
      discountSatang: item.discountSatang,
      vatTreatment: item.vatTreatment,
    })),
  }
}

async function loadOrder(tx: DatabaseTransaction, orderId: string) {
  const [order] = await tx.select().from(commerceOrder).where(eq(commerceOrder.id, orderId)).limit(1)
  if (!order) throw new DomainError('ORDER_NOT_FOUND')
  const itemRows = await tx.select().from(orderItem)
    .where(eq(orderItem.orderId, orderId))
    .orderBy(asc(orderItem.createdAt), asc(orderItem.id))
  return { snapshot: orderSnapshotOf(order, itemRows), shipment: shipmentOf(order) }
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

export async function readOrderReceiptSummary(
  tx: DatabaseTransaction,
  orderId: string,
): Promise<OrderReceiptSummary | null> {
  const [saved] = await tx.select({
    number: receipt.receiptNumber,
    kind: receipt.kind,
    status: receipt.status,
    issuedAt: receipt.issuedAt,
  }).from(receipt).where(eq(receipt.orderId, orderId)).limit(1)
  return saved ? { ...saved, issuedAt: saved.issuedAt.toISOString() } : null
}

// Loads payment, latest refund, and receipt for many orders in three queries.
async function readOrderRelations(tx: DatabaseTransaction, orderIds: string[]) {
  const payments = await tx.select({
    id: payment.id,
    orderId: payment.orderId,
    method: payment.method,
    provider: payment.provider,
    amountSatang: payment.amountSatang,
    currency: payment.currency,
    status: payment.status,
  }).from(payment).where(inArray(payment.orderId, orderIds))
  const paymentByOrder = new Map<string, (typeof payments)[number]>()
  for (const row of payments) if (!paymentByOrder.has(row.orderId)) paymentByOrder.set(row.orderId, row)
  const paymentIds = [...paymentByOrder.values()].map((row) => row.id)
  const refunds = paymentIds.length ? await tx.selectDistinctOn([stripeRefund.paymentId], {
    id: stripeRefund.id,
    paymentId: stripeRefund.paymentId,
    amountSatang: stripeRefund.amountSatang,
    status: stripeRefund.status,
    createdAt: stripeRefund.createdAt,
    updatedAt: stripeRefund.updatedAt,
  }).from(stripeRefund).where(inArray(stripeRefund.paymentId, paymentIds))
    .orderBy(stripeRefund.paymentId, desc(stripeRefund.createdAt), desc(stripeRefund.id)) : []
  const refundByPayment = new Map(refunds.map((row) => [row.paymentId, row]))
  const receipts = await tx.select({
    orderId: receipt.orderId,
    number: receipt.receiptNumber,
    kind: receipt.kind,
    status: receipt.status,
    issuedAt: receipt.issuedAt,
  }).from(receipt).where(inArray(receipt.orderId, orderIds))
  const receiptByOrder = new Map(receipts.map((row) => [row.orderId, row]))

  return (order: OrderSnapshot, shipment: OrderShipment | null): OrderDetail => {
    const savedPayment = paymentByOrder.get(order.id)
    if (!savedPayment) throw new DomainError('ORDER_PAYMENT_CONFLICT')
    const { orderId: _orderId, ...paymentFields } = savedPayment
    const refund = refundByPayment.get(savedPayment.id)
    const saved = receiptByOrder.get(order.id)
    return {
      ...order,
      ...(shipment ? { shipment } : {}),
      receipt: saved
        ? { number: saved.number, kind: saved.kind, status: saved.status, issuedAt: saved.issuedAt.toISOString() }
        : null,
      payment: {
        ...paymentFields,
        currency: 'THB',
        ...(refund ? {
          refund: {
            id: refund.id,
            amountSatang: refund.amountSatang,
            status: refund.status,
            createdAt: refund.createdAt.toISOString(),
            updatedAt: refund.updatedAt.toISOString(),
          },
        } : {}),
      },
    }
  }
}

export async function readOrderDetail(tx: DatabaseTransaction, orderId: string): Promise<OrderDetail> {
  const { snapshot, shipment } = await loadOrder(tx, orderId)
  const toDetail = await readOrderRelations(tx, [orderId])
  return toDetail(snapshot, shipment)
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

const orderSortColumns = {
  createdAt: commerceOrder.createdAt,
  orderNumber: commerceOrder.orderNumber,
  recipientName: commerceOrder.recipientName,
  status: commerceOrder.status,
  totalSatang: commerceOrder.totalSatang,
} as const
const defaultOrderSort: OrderSort = { field: 'createdAt', direction: 'desc' }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isDefaultOrderSort(sort: OrderSort) {
  return sort.field === defaultOrderSort.field && sort.direction === defaultOrderSort.direction
}

// Cursor values travel as text built by Postgres, so timestamps keep their microseconds.
function orderSortCursorText(field: OrderSortField) {
  const column = orderSortColumns[field]
  return field === 'createdAt'
    ? sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
    : sql<string>`${column}::text`
}

function orderSortCursorParam(field: OrderSortField, value: string) {
  if (field === 'createdAt') return sql`${value}::timestamptz`
  if (field === 'totalSatang') return sql`${value}::bigint`
  return sql`${value}`
}

function assertOrderSortValue(field: OrderSortField, value: string) {
  if (field === 'createdAt' && !Number.isFinite(Date.parse(value))) throw new Error('INVALID_CURSOR')
  if (field === 'totalSatang' && !/^\d{1,16}$/.test(value)) throw new Error('INVALID_CURSOR')
  return value
}

// The default sort keeps the original { createdAt, id } cursor; other sorts bind the cursor to their sort.
function decodeOrderCursor(cursor: string | undefined, sort: OrderSort) {
  const decoded = isDefaultOrderSort(sort)
    ? decodeCursor(cursor, ['createdAt', 'id'])
    : decodeCursor(cursor, ['sort', 'value', 'id'])
  if (!decoded) return null
  if (!uuidPattern.test(decoded.id)) throw new Error('INVALID_CURSOR')
  if (isDefaultOrderSort(sort)) return { value: assertOrderSortValue('createdAt', decoded.createdAt), id: decoded.id }
  if (decoded.sort !== `${sort.field}.${sort.direction}`) throw new Error('INVALID_CURSOR')
  return { value: assertOrderSortValue(sort.field, decoded.value), id: decoded.id }
}

function encodeOrderCursor(sort: OrderSort, value: string, id: string) {
  return isDefaultOrderSort(sort)
    ? encodeCursor({ createdAt: value, id })
    : encodeCursor({ sort: `${sort.field}.${sort.direction}`, value, id })
}

export async function listOrderDetails(
  tx: DatabaseTransaction,
  query: { customerId?: string; cursor?: string; limit: number; sort?: OrderSort },
): Promise<OrderPage> {
  const sort = query.sort ?? defaultOrderSort
  const column = orderSortColumns[sort.field]
  const [operator, direction] = sort.direction === 'desc' ? [sql.raw('<'), desc] : [sql.raw('>'), asc]
  const cursor = decodeOrderCursor(query.cursor, sort)
  const rows = await tx.select({ id: commerceOrder.id, cursorValue: orderSortCursorText(sort.field) })
    .from(commerceOrder).where(and(
      query.customerId ? eq(commerceOrder.customerId, query.customerId) : undefined,
      // A row comparison lets Postgres start the (column, id) index scan at the cursor.
      cursor
        ? sql`(${column}, ${commerceOrder.id}) ${operator} (${orderSortCursorParam(sort.field, cursor.value)}, ${cursor.id}::uuid)`
        : undefined,
    )).orderBy(direction(column), direction(commerceOrder.id)).limit(query.limit + 1)
  const hasMore = rows.length > query.limit
  const pageRows = rows.slice(0, query.limit)
  const items = await readOrderDetails(tx, pageRows.map((row) => row.id))
  const last = pageRows.at(-1)
  return {
    items,
    nextCursor: hasMore && last ? encodeOrderCursor(sort, last.cursorValue, last.id) : null,
  }
}

// Batched equivalent of readOrderDetail for a page of orders, preserving the given order.
async function readOrderDetails(tx: DatabaseTransaction, orderIds: string[]): Promise<OrderDetail[]> {
  if (!orderIds.length) return []
  const orders = await tx.select().from(commerceOrder).where(inArray(commerceOrder.id, orderIds))
  const itemRows = await tx.select().from(orderItem)
    .where(inArray(orderItem.orderId, orderIds))
    .orderBy(asc(orderItem.createdAt), asc(orderItem.id))
  const itemsByOrder = new Map<string, OrderItemRow[]>()
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.orderId)
    if (list) list.push(item)
    else itemsByOrder.set(item.orderId, [item])
  }
  const orderById = new Map(orders.map((order) => [order.id, order]))
  const toDetail = await readOrderRelations(tx, orderIds)
  return orderIds.map((orderId) => {
    const order = orderById.get(orderId)
    if (!order) throw new DomainError('ORDER_NOT_FOUND')
    return toDetail(orderSnapshotOf(order, itemsByOrder.get(orderId) ?? []), shipmentOf(order))
  })
}
