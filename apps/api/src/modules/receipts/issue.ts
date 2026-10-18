import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DatabaseTransaction } from '../../database/types'
import {
  auditLog,
  commerceOrder,
  orderEvent,
  orderItem,
  payment,
  receipt,
  receiptCounter,
} from '../../database/schema'
import { assertAuditMetadata, type AuditContext, type AuditEvent } from '../audit/model'
import { enqueueOrderEmail } from '../orders/outbox'
import { formatReceiptNumber, receiptPeriod } from './number'
import { readCompleteSeller } from './settings'
import type { ReceiptIssueActor, ReceiptIssueResult, ReceiptSnapshot } from './types'
import { computeReceiptTotals, receiptKindFor } from './vat'

const receiptEventTypes = ['receipt.issued', 'receipt.deferred', 'receipt.cancelled']

export interface ReceiptIssueOptions {
  operationId?: string
  auditContext?: AuditContext
}

function eventActor(actor: ReceiptIssueActor) {
  return actor.type === 'staff'
    ? { actorType: 'staff' as const, actorId: actor.userId }
    : { actorType: 'system' as const, actorId: null }
}

export async function recordReceiptAudit(tx: DatabaseTransaction, event: AuditEvent) {
  assertAuditMetadata(event)
  await tx.insert(auditLog).values({
    id: event.id,
    actorUserId: event.actorUserId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    requestId: event.requestId,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    metadata: event.metadata,
  })
}

// Money counts as received for a Stripe order once its payment is collected, and for a COD
// order once its payment is collected and the order is delivered. Cancelled orders never qualify.
export function isReceiptEligible(
  order: Pick<typeof commerceOrder.$inferSelect, 'status' | 'paymentMethod'>,
  paymentStatus: string,
) {
  if (order.status === 'cancelled' || order.status === 'pending_payment') return false
  if (paymentStatus !== 'collected') return false
  if (order.paymentMethod === 'stripe') return true
  return order.paymentMethod === 'cod' && order.status === 'delivered'
}

async function readPaidAt(tx: DatabaseTransaction, orderId: string, paymentMethod: string) {
  const [paidEvent] = await tx.select({ createdAt: orderEvent.createdAt }).from(orderEvent)
    .where(and(
      eq(orderEvent.orderId, orderId),
      paymentMethod === 'cod'
        ? eq(orderEvent.eventType, 'payment.cod-collected')
        : and(eq(orderEvent.eventType, 'order.placed'), eq(orderEvent.reasonCode, 'stripe_payment_collected')),
    ))
    .orderBy(asc(orderEvent.createdAt), asc(orderEvent.id)).limit(1)
  return paidEvent ? paidEvent.createdAt.toISOString() : null
}

// Issues the receipt for a paid order inside the caller's transaction. The caller must already
// hold the order row lock, which serializes every trigger for the same order.
export async function issueReceiptInTransaction(
  tx: DatabaseTransaction,
  orderId: string,
  actor: ReceiptIssueActor,
  options: ReceiptIssueOptions = {},
): Promise<ReceiptIssueResult> {
  const [existing] = await tx.select({ id: receipt.id }).from(receipt)
    .where(eq(receipt.orderId, orderId)).limit(1)
  if (existing) return 'exists'

  const [order] = await tx.select().from(commerceOrder).where(eq(commerceOrder.id, orderId)).limit(1)
  if (!order) return 'not_eligible'
  const [savedPayment] = await tx.select({ status: payment.status }).from(payment)
    .where(eq(payment.orderId, orderId)).limit(1)
  if (!savedPayment || !isReceiptEligible(order, savedPayment.status)) return 'not_eligible'

  const settings = await readCompleteSeller(tx)
  if (!settings) {
    const [latest] = await tx.select({ eventType: orderEvent.eventType }).from(orderEvent)
      .where(and(eq(orderEvent.orderId, orderId), inArray(orderEvent.eventType, receiptEventTypes)))
      .orderBy(desc(orderEvent.createdAt), desc(orderEvent.id)).limit(1)
    if (latest?.eventType !== 'receipt.deferred') {
      await tx.insert(orderEvent).values({
        id: crypto.randomUUID(),
        orderId,
        eventType: 'receipt.deferred',
        ...eventActor(actor),
        metadata: {},
      })
    }
    return 'deferred'
  }

  const items = await tx.select().from(orderItem)
    .where(eq(orderItem.orderId, orderId))
    .orderBy(asc(orderItem.createdAt), asc(orderItem.id))
  const lines = items.map((item) => ({
    productName: item.productName,
    variantName: item.variantName,
    unit: item.unit,
    quantity: item.quantity,
    unitPriceSatang: item.unitPriceSatang,
    lineTotalSatang: item.lineTotalSatang,
    vatTreatment: item.vatTreatment,
  }))
  const totals = computeReceiptTotals({
    lines,
    shippingSatang: order.shippingSatang,
    vatRateBasisPoints: settings.vatRateBasisPoints,
  })

  // The counter row stays locked until commit, so concurrent issuers queue in commit order and a
  // rollback returns the value: numbers stay gap-free, unlike a Postgres sequence.
  const issuedAt = new Date()
  const period = receiptPeriod(issuedAt)
  const [counter] = await tx.insert(receiptCounter).values({ period, lastValue: 1 })
    .onConflictDoUpdate({
      target: receiptCounter.period,
      set: { lastValue: sql`${receiptCounter.lastValue} + 1` },
    })
    .returning({ lastValue: receiptCounter.lastValue })
  if (!counter) throw new Error('RECEIPT_COUNTER_UNAVAILABLE')

  const receiptNumber = formatReceiptNumber(period, counter.lastValue)
  const kind = receiptKindFor(totals)
  const snapshot: ReceiptSnapshot = {
    version: 1,
    kind,
    receiptNumber,
    issuedAt: issuedAt.toISOString(),
    paidAt: await readPaidAt(tx, orderId, order.paymentMethod),
    seller: settings.seller,
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
    orderNumber: order.orderNumber,
    paymentMethod: order.paymentMethod as ReceiptSnapshot['paymentMethod'],
    lines,
    shippingSatang: order.shippingSatang,
    totals,
  }

  const receiptId = crypto.randomUUID()
  await tx.insert(receipt).values({
    id: receiptId,
    orderId,
    receiptNumber,
    kind,
    status: 'issued',
    issuedAt,
    snapshot: snapshot as unknown as Record<string, unknown>,
  })
  const issuedEventId = crypto.randomUUID()
  await tx.insert(orderEvent).values({
    id: issuedEventId,
    orderId,
    eventType: 'receipt.issued',
    ...eventActor(actor),
    metadata: { receiptId },
  })
  await enqueueOrderEmail(tx, { orderId, orderEventId: issuedEventId, eventType: 'receipt.issued', templateId: 'receipt_issued' })
  await recordReceiptAudit(tx, {
    id: crypto.randomUUID(),
    actorUserId: actor.type === 'staff' ? actor.userId : null,
    action: 'order.receipt-issued',
    targetType: 'commerce_order',
    targetId: orderId,
    ...(options.auditContext ?? { requestId: orderId, ipAddress: null, userAgent: null }),
    metadata: {
      ...(actor.type === 'staff' ? { actorId: actor.userId } : {}),
      receiptId,
      ...(options.operationId ? { operationId: options.operationId } : {}),
    },
  })
  return 'issued'
}
