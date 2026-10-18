import { createHash, randomBytes } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import {
  auditLog,
  commerceOrder,
  inventoryOperation,
  orderEvent,
  orderItem,
  orderOutbox,
  payment,
  receipt,
} from '../../database/schema'
import { assertAuditMetadata, type AuditEvent } from '../audit/model'
import { CodPaymentProvider } from '../payments/cod'
import { DomainError } from '../../shared/domain-error'
import {
  deriveGuestOrderToken,
  guestOrderTokenVerifierMatches,
  hashGuestOrderToken,
  isGuestOrderAccessExpired,
} from './access'
import { listOrderDetails, lockOrder, readOpenStripeCheckout, readOrderDetail } from './repository'
import { enqueueOrderEmail } from './outbox'
import { restoreOrderAllocations, releaseOrderAllocations } from '../inventory/reservation-repository'
import { runOrderCommand, type OrderCommandResult, type OrderOperationRecord } from './operation'
import { issueReceiptInTransaction } from '../receipts/issue'
import type { ReceiptSnapshot } from '../receipts/types'
import type {
  OrderDetail,
  OrderPage,
  OrderPrincipal,
  OrderStaffActor,
  OrderStatus,
  ShipmentInput,
  StoreOrderDetail,
} from './types'

const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fulfillmentTransitions: Partial<Record<OrderStatus, OrderStatus>> = {
  placed: 'processing',
  processing: 'packed',
  packed: 'shipped',
  shipped: 'delivered',
}
const guestAccessReasonCodes = new Set(['customer_request', 'suspected_compromise', 'support_recovery'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function assertOrderId(orderId: string) {
  if (typeof orderId !== 'string' || !orderIdPattern.test(orderId)) throw new DomainError('ORDER_NOT_FOUND')
}

function assertPrincipal(principal: OrderPrincipal): asserts principal is OrderPrincipal {
  if (!principal || typeof principal !== 'object') throw new DomainError('ORDER_ACCESS_DENIED')
  if (principal.kind === 'customer' && typeof principal.userId === 'string' && principal.userId.trim()) return
  if (principal.kind === 'guest' && typeof principal.accessToken === 'string') return
  if (principal.kind === 'staff' && typeof principal.userId === 'string' && principal.userId.trim()) return
  throw new DomainError('ORDER_ACCESS_DENIED')
}

function assertStaffActor(actor: OrderStaffActor): asserts actor is OrderStaffActor {
  if (!actor || typeof actor !== 'object' || actor.kind !== 'staff'
    || typeof actor.userId !== 'string' || !actor.userId.trim()) {
    throw new DomainError('ORDER_ACCESS_DENIED')
  }
}

function ownerScope(principal: OrderPrincipal) {
  if (principal.kind === 'customer') return `customer:${principal.userId}`
  if (principal.kind === 'staff') return `staff:${principal.userId}`
  return `guest:${hashGuestOrderToken(principal.accessToken)}`
}

function principalId(principal: OrderPrincipal, orderId: string) {
  return principal.kind === 'guest' ? orderId : principal.userId
}

function assertCanAccess(order: typeof commerceOrder.$inferSelect, principal: OrderPrincipal) {
  if (principal.kind === 'staff') return
  if (principal.kind === 'customer') {
    if (order.customerId !== principal.userId) throw new DomainError('ORDER_ACCESS_DENIED')
    return
  }
  if (order.customerId !== null
    || !guestOrderTokenVerifierMatches(order.guestAccessTokenHash, principal.accessToken)) {
    throw new DomainError('ORDER_NOT_FOUND')
  }
  if ((order.status === 'cancelled' || order.status === 'delivered') && order.terminalAt
    && isGuestOrderAccessExpired(order.terminalAt, new Date())) {
    throw new DomainError('ORDER_NOT_FOUND')
  }
}

function assertGuestAccessReasonCode(reasonCode: string) {
  if (!guestAccessReasonCodes.has(reasonCode)) throw new DomainError('INVALID_ORDER_COMMAND')
}

function actorType(principal: OrderPrincipal): 'customer' | 'guest' | 'staff' {
  return principal.kind
}

function auditContextFor(principal: OrderPrincipal, orderId: string) {
  if (principal.kind === 'staff' && principal.auditContext) return principal.auditContext
  return { requestId: orderId, ipAddress: null, userAgent: null }
}

async function recordOrderAudit(tx: DatabaseTransaction, event: AuditEvent) {
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

async function lockOrderPayment(tx: DatabaseTransaction, orderId: string) {
  const [savedPayment] = await tx.select().from(payment)
    .where(eq(payment.orderId, orderId)).for('update').limit(1)
  if (!savedPayment) throw new DomainError('ORDER_PAYMENT_CONFLICT')
  return savedPayment
}

function commandResult(orderId: string, detail: OrderDetail): OrderCommandResult<OrderDetail> {
  return {
    orderId,
    httpStatus: 200,
    resultPayload: { order: detail as unknown as Record<string, unknown> },
    value: detail,
  }
}

const trackingNumberPattern = /^[A-Za-z0-9-]{4,40}$/

function normalizeShipment(nextStatus: OrderStatus, input: ShipmentInput | undefined) {
  if (nextStatus !== 'shipped') {
    if (input) throw new DomainError('INVALID_ORDER_COMMAND')
    return null
  }
  if (!input) throw new DomainError('SHIPMENT_REQUIRED')
  const trackingNumber = input.trackingNumber.trim().toUpperCase()
  const carrierName = input.carrierName?.trim() ?? ''
  if (!trackingNumberPattern.test(trackingNumber)) throw new DomainError('INVALID_SHIPMENT')
  if (input.carrier === 'other' ? carrierName.length < 1 || carrierName.length > 80 : carrierName.length > 0) {
    throw new DomainError('INVALID_SHIPMENT')
  }
  return { carrier: input.carrier, carrierName: input.carrier === 'other' ? carrierName : null, trackingNumber }
}

function replayOrder(existing: OrderOperationRecord): OrderDetail {
  const order = existing.resultPayload.order
  if (!isRecord(order) || order.id !== existing.orderId || !isRecord(order.payment) || !Array.isArray(order.items)) {
    throw new DomainError('INVALID_ORDER_COMMAND')
  }
  return order as unknown as OrderDetail
}

async function replayAuthorizedOrder(
  tx: DatabaseTransaction,
  existing: OrderOperationRecord,
  principal: OrderPrincipal,
): Promise<OrderDetail> {
  const [order] = await tx.select().from(commerceOrder).where(eq(commerceOrder.id, existing.orderId)).limit(1)
  if (!order) throw new DomainError('ORDER_NOT_FOUND')
  assertCanAccess(order, principal)
  return replayOrder(existing)
}

function inventoryActorIdFor(principal: OrderPrincipal, orderId: string) {
  return principal.kind === 'guest' ? orderId : principal.userId
}

export async function settleStripeOrderInTransaction(tx: DatabaseTransaction, input: {
  order: typeof commerceOrder.$inferSelect
  payment: typeof payment.$inferSelect
  eventId: string
  sessionId: string
  paymentIntentId: string | null
}) {
  if (input.order.status !== 'pending_payment' || input.payment.status !== 'awaiting_collection') return false
  const [collected] = await tx.update(payment).set({
    status: 'collected',
    providerReference: input.paymentIntentId,
    updatedAt: sql`transaction_timestamp()`,
  }).where(and(eq(payment.id, input.payment.id), eq(payment.status, 'awaiting_collection')))
    .returning({ id: payment.id })
  if (!collected) return false

  const [placed] = await tx.update(commerceOrder).set({
    status: 'placed',
    terminalAt: null,
    updatedAt: sql`transaction_timestamp()`,
  }).where(and(eq(commerceOrder.id, input.order.id), eq(commerceOrder.status, 'pending_payment')))
    .returning({ id: commerceOrder.id })
  if (!placed) throw new DomainError('ORDER_PAYMENT_CONFLICT')

  const orderEventId = crypto.randomUUID()
  await tx.insert(orderEvent).values({
    id: orderEventId,
    orderId: input.order.id,
    paymentId: input.payment.id,
    eventType: 'order.placed',
    fromStatus: 'pending_payment',
    toStatus: 'placed',
    actorType: 'system',
    actorId: null,
    reasonCode: 'stripe_payment_collected',
    metadata: {
      stripeEventId: input.eventId,
      stripeSessionId: input.sessionId,
      paymentIntentId: input.paymentIntentId,
      totalSatang: input.order.totalSatang,
    },
  })
  await tx.insert(orderOutbox).values({
    id: crypto.randomUUID(),
    orderId: input.order.id,
    orderEventId,
    eventType: 'order.placed',
    templateId: 'order_confirmation',
    status: 'pending',
    attemptCount: 0,
  })
  const [lineCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(orderItem)
    .where(eq(orderItem.orderId, input.order.id))
  await recordOrderAudit(tx, {
    id: crypto.randomUUID(),
    actorUserId: null,
    action: 'order.placed',
    targetType: 'commerce_order',
    targetId: input.order.id,
    requestId: input.order.id,
    ipAddress: null,
    userAgent: null,
    metadata: {
      actorType: 'system',
      principalId: input.order.id,
      reservationId: input.order.reservationId,
      paymentId: input.payment.id,
      totalSatang: input.order.totalSatang,
      lineCount: Number(lineCount?.count ?? 0),
    },
  })
  await issueReceiptInTransaction(tx, input.order.id, { type: 'system' })
  return true
}

export async function cancelStripeOrderInTransaction(tx: DatabaseTransaction, input: {
  order: typeof commerceOrder.$inferSelect
  payment: typeof payment.$inferSelect
  eventId: string
  sessionId: string
  reason: 'stripe_payment_failed' | 'stripe_session_expired'
}) {
  if (input.order.status !== 'pending_payment' || input.payment.status !== 'awaiting_collection') return false
  const operationId = crypto.randomUUID()
  const requestHash = createHash('sha256')
    .update(`${input.reason}:${input.eventId}:${input.order.id}`)
    .digest('hex')
  await tx.insert(inventoryOperation).values({
    id: operationId,
    scope: 'orders.cancel.restore',
    idempotencyKey: operationId,
    requestHash,
    httpStatus: 200,
    resultPayload: { orderId: input.order.id, restoredQuantity: 0 },
    actorId: input.order.id,
  })
  const restoredQuantity = await restoreOrderAllocations(tx, input.order.id, operationId)
  await tx.update(inventoryOperation).set({ resultPayload: { orderId: input.order.id, restoredQuantity } })
    .where(eq(inventoryOperation.id, operationId))
  const [voided] = await tx.update(payment).set({
    status: 'void',
    updatedAt: sql`transaction_timestamp()`,
  }).where(and(eq(payment.id, input.payment.id), eq(payment.status, 'awaiting_collection')))
    .returning({ id: payment.id })
  if (!voided) throw new DomainError('ORDER_PAYMENT_CONFLICT')
  const [cancelled] = await tx.update(commerceOrder).set({
    status: 'cancelled',
    terminalAt: sql`transaction_timestamp()`,
    updatedAt: sql`transaction_timestamp()`,
  }).where(and(eq(commerceOrder.id, input.order.id), eq(commerceOrder.status, 'pending_payment')))
    .returning({ id: commerceOrder.id })
  if (!cancelled) throw new DomainError('ORDER_PAYMENT_CONFLICT')

  await tx.insert(orderEvent).values({
    id: crypto.randomUUID(),
    orderId: input.order.id,
    paymentId: input.payment.id,
    eventType: 'order.cancelled',
    fromStatus: 'pending_payment',
    toStatus: 'cancelled',
    actorType: 'system',
    actorId: null,
    reasonCode: input.reason,
    metadata: {
      operationId,
      stripeEventId: input.eventId,
      stripeSessionId: input.sessionId,
      restoredQuantity,
      totalSatang: input.order.totalSatang,
    },
  })
  await recordOrderAudit(tx, {
    id: crypto.randomUUID(),
    actorUserId: null,
    action: 'order.cancelled',
    targetType: 'commerce_order',
    targetId: input.order.id,
    requestId: input.order.id,
    ipAddress: null,
    userAgent: null,
    metadata: {
      actorType: 'system',
      principalId: input.order.id,
      operationId,
      restoredQuantity,
      totalSatang: input.order.totalSatang,
    },
  })
  return true
}

export class OrderService {
  private readonly codPayment = new CodPaymentProvider()

  constructor(private readonly db: Database, private readonly commerceSecret?: Uint8Array) {}

  async getForPrincipal(orderId: string, principal: OrderPrincipal): Promise<OrderDetail> {
    assertOrderId(orderId)
    assertPrincipal(principal)
    return this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(commerceOrder).where(eq(commerceOrder.id, orderId)).limit(1)
      if (!order) throw new DomainError('ORDER_NOT_FOUND')
      assertCanAccess(order, principal)
      return readOrderDetail(tx, orderId)
    })
  }

  async getStoreOrder(orderId: string, principal: OrderPrincipal): Promise<StoreOrderDetail> {
    assertOrderId(orderId)
    assertPrincipal(principal)
    return this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(commerceOrder).where(eq(commerceOrder.id, orderId)).limit(1)
      if (!order) throw new DomainError('ORDER_NOT_FOUND')
      assertCanAccess(order, principal)
      const detail = await readOrderDetail(tx, orderId)
      const checkout = order.status === 'pending_payment' ? await readOpenStripeCheckout(tx, orderId) : null
      return checkout ? { ...detail, checkout } : detail
    })
  }

  // Same principal check as the order detail reads, except a foreign customer order is reported as not found.
  async readReceipt(orderId: string, principal: OrderPrincipal): Promise<{
    snapshot: ReceiptSnapshot
    status: 'issued' | 'cancelled'
    receiptNumber: string
  }> {
    assertOrderId(orderId)
    assertPrincipal(principal)
    return this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(commerceOrder).where(eq(commerceOrder.id, orderId)).limit(1)
      if (!order) throw new DomainError('ORDER_NOT_FOUND')
      try {
        assertCanAccess(order, principal)
      } catch (error) {
        // Downloads never confirm that another customer's order exists.
        if (error instanceof DomainError && error.code === 'ORDER_ACCESS_DENIED') throw new DomainError('ORDER_NOT_FOUND')
        throw error
      }
      const [saved] = await tx.select({
        snapshot: receipt.snapshot, status: receipt.status, receiptNumber: receipt.receiptNumber,
      }).from(receipt).where(eq(receipt.orderId, orderId)).limit(1)
      if (!saved) throw new DomainError('RECEIPT_NOT_FOUND')
      return {
        snapshot: saved.snapshot as unknown as ReceiptSnapshot,
        status: saved.status as 'issued' | 'cancelled',
        receiptNumber: saved.receiptNumber,
      }
    })
  }

  listCustomer(userId: string, cursor: string | undefined, limit: number): Promise<OrderPage> {
    if (typeof userId !== 'string' || !userId.trim()) throw new DomainError('INVALID_ORDER_QUERY')
    return this.list({ customerId: userId, cursor, limit })
  }

  listStaff(staffActor: OrderStaffActor, cursor: string | undefined, limit: number): Promise<OrderPage> {
    assertStaffActor(staffActor)
    return this.list({ cursor, limit })
  }

  private list(query: { customerId?: string; cursor?: string; limit: number }): Promise<OrderPage> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100
      || (query.cursor !== undefined && typeof query.cursor !== 'string')) {
      throw new DomainError('INVALID_ORDER_QUERY')
    }
    return this.db.transaction((tx) => listOrderDetails(tx, query))
  }

  cancel(orderId: string, principal: OrderPrincipal, key: string): Promise<OrderDetail> {
    assertOrderId(orderId)
    assertPrincipal(principal)
    const scope = ownerScope(principal)
    const command = 'cancel'
    return runOrderCommand(this.db, {
      scope,
      command,
      idempotencyKey: key,
      payload: { orderId },
    }, async (tx, existing) => replayAuthorizedOrder(tx, existing, principal), async (tx, requestHash, operationId) => {
      const order = await lockOrder(tx, orderId)
      assertCanAccess(order, principal)
      if (order.status === 'cancelled') {
        return commandResult(orderId, await readOrderDetail(tx, orderId))
      }
      if (!['placed', 'processing', 'packed'].includes(order.status)) {
        throw new DomainError('INVALID_ORDER_TRANSITION')
      }

      const savedPayment = await lockOrderPayment(tx, orderId)
      if (savedPayment.status !== 'awaiting_collection' && savedPayment.status !== 'collected') {
        throw new DomainError('ORDER_PAYMENT_CONFLICT')
      }

      await tx.insert(inventoryOperation).values({
        id: operationId,
        scope: 'orders.cancel.restore',
        idempotencyKey: operationId,
        requestHash,
        httpStatus: 200,
        resultPayload: { orderId, restoredQuantity: 0 },
        actorId: inventoryActorIdFor(principal, orderId),
      })
      const restoredQuantity = await restoreOrderAllocations(tx, orderId, operationId)
      await tx.update(inventoryOperation).set({ resultPayload: { orderId, restoredQuantity } })
        .where(eq(inventoryOperation.id, operationId))
      if (savedPayment.status === 'awaiting_collection') {
        const [voidedPayment] = await tx.update(payment).set({ status: 'void' })
          .where(and(eq(payment.id, savedPayment.id), eq(payment.status, 'awaiting_collection')))
          .returning({ id: payment.id })
        if (!voidedPayment) throw new DomainError('ORDER_PAYMENT_CONFLICT')
      }
      const [updatedOrder] = await tx.update(commerceOrder).set({
        status: 'cancelled',
        terminalAt: sql`transaction_timestamp()`,
      }).where(eq(commerceOrder.id, orderId)).returning({ status: commerceOrder.status })
      if (updatedOrder?.status !== 'cancelled') throw new DomainError('INVALID_ORDER_TRANSITION')

      const type = actorType(principal)
      const id = principalId(principal, orderId)
      const cancelledEventId = crypto.randomUUID()
      await tx.insert(orderEvent).values({
        id: cancelledEventId,
        orderId,
        paymentId: savedPayment.id,
        eventType: 'order.cancelled',
        fromStatus: order.status,
        toStatus: 'cancelled',
        actorType: type,
        actorId: id,
        reasonCode: `cancelled_by_${type}`,
        metadata: { operationId, restoredQuantity, totalSatang: order.totalSatang },
      })
      await enqueueOrderEmail(tx, { orderId, orderEventId: cancelledEventId, eventType: 'order.cancelled', templateId: 'order_cancelled' })
      const auditContext = auditContextFor(principal, orderId)
      await recordOrderAudit(tx, {
        id: crypto.randomUUID(),
        actorUserId: principal.kind === 'guest' ? null : principal.userId,
        action: 'order.cancelled',
        targetType: 'commerce_order',
        targetId: orderId,
        ...auditContext,
        metadata: {
          actorType: type,
          principalId: id,
          operationId,
          restoredQuantity,
          totalSatang: order.totalSatang,
        },
      })
      return commandResult(orderId, await readOrderDetail(tx, orderId))
    })
  }

  async advanceFulfillment(
    orderId: string,
    nextStatus: OrderStatus,
    staffActor: OrderStaffActor,
    key: string,
    shipmentInput?: ShipmentInput,
  ): Promise<OrderDetail> {
    assertOrderId(orderId)
    assertStaffActor(staffActor)
    if (!['processing', 'packed', 'shipped', 'delivered'].includes(nextStatus)) {
      throw new DomainError('INVALID_ORDER_TRANSITION')
    }
    const shipment = normalizeShipment(nextStatus, shipmentInput)
    const command = 'advance-fulfillment'
    return runOrderCommand(this.db, {
      scope: `staff:${staffActor.userId}`,
      command,
      idempotencyKey: key,
      payload: shipment ? { orderId, nextStatus, shipment } : { orderId, nextStatus },
    }, async (_tx, existing) => replayOrder(existing), async (tx, _requestHash, operationId) => {
      const order = await lockOrder(tx, orderId)
      if (order.status === nextStatus) return commandResult(orderId, await readOrderDetail(tx, orderId))
      if (fulfillmentTransitions[order.status] !== nextStatus) throw new DomainError('INVALID_ORDER_TRANSITION')
      if (nextStatus === 'shipped') await releaseOrderAllocations(tx, orderId)

      const [updatedOrder] = await tx.update(commerceOrder).set({
        status: nextStatus,
        terminalAt: nextStatus === 'delivered' ? sql`transaction_timestamp()` : null,
        ...(shipment ? {
          shipmentCarrier: shipment.carrier,
          shipmentCarrierName: shipment.carrierName,
          trackingNumber: shipment.trackingNumber,
          shippedAt: sql`transaction_timestamp()`,
        } : {}),
      }).where(eq(commerceOrder.id, orderId)).returning({ status: commerceOrder.status })
      if (updatedOrder?.status !== nextStatus) throw new DomainError('INVALID_ORDER_TRANSITION')

      const fulfillmentEventId = crypto.randomUUID()
      await tx.insert(orderEvent).values({
        id: fulfillmentEventId,
        orderId,
        eventType: 'order.fulfillment-advanced',
        fromStatus: order.status,
        toStatus: nextStatus,
        actorType: 'staff',
        actorId: staffActor.userId,
        metadata: shipment ? { operationId, shipment } : { operationId },
      })
      if (shipment) {
        await enqueueOrderEmail(tx, { orderId, orderEventId: fulfillmentEventId, eventType: 'order.fulfillment-advanced', templateId: 'order_shipped' })
      }
      const context = staffActor.auditContext ?? { requestId: orderId, ipAddress: null, userAgent: null }
      await recordOrderAudit(tx, {
        id: crypto.randomUUID(),
        actorUserId: staffActor.userId,
        action: 'order.fulfillment-advanced',
        targetType: 'commerce_order',
        targetId: orderId,
        ...context,
        metadata: {
          actorId: staffActor.userId,
          fromStatus: order.status,
          toStatus: nextStatus,
          operationId,
        },
      })
      // A COD receipt is issued by whichever of delivery and collection completes second.
      if (nextStatus === 'delivered') {
        await issueReceiptInTransaction(tx, orderId, { type: 'staff', userId: staffActor.userId }, {
          operationId,
          auditContext: context,
        })
      }
      return commandResult(orderId, await readOrderDetail(tx, orderId))
    })
  }

  collectCod(
    orderId: string,
    amountSatang: number,
    staffActor: OrderStaffActor,
    key: string,
  ): Promise<OrderDetail> {
    assertOrderId(orderId)
    assertStaffActor(staffActor)
    if (!Number.isSafeInteger(amountSatang) || amountSatang < 0) throw new DomainError('INVALID_PAYMENT_AMOUNT')
    const command = 'collect-cod'
    return runOrderCommand(this.db, {
      scope: `staff:${staffActor.userId}`,
      command,
      idempotencyKey: key,
      payload: { orderId, amountSatang },
    }, async (_tx, existing) => replayOrder(existing), async (tx, _requestHash, operationId) => {
      const order = await lockOrder(tx, orderId)
      if (order.status === 'cancelled') throw new DomainError('INVALID_ORDER_TRANSITION')
      const savedPayment = await lockOrderPayment(tx, orderId)
      if (order.paymentMethod !== 'cod'
        || savedPayment.method !== 'cod'
        || savedPayment.provider !== 'cod'
        || savedPayment.amountSatang !== order.totalSatang) {
        throw new DomainError('ORDER_PAYMENT_CONFLICT')
      }
      const collection = this.codPayment.recordCollection(amountSatang, order.totalSatang)
      if (savedPayment.status === 'void') throw new DomainError('ORDER_PAYMENT_CONFLICT')
      if (savedPayment.status === 'awaiting_collection') {
        const [collectedPayment] = await tx.update(payment).set({ status: collection.status })
          .where(and(eq(payment.id, savedPayment.id), eq(payment.status, 'awaiting_collection')))
          .returning({ id: payment.id })
        if (!collectedPayment) throw new DomainError('ORDER_PAYMENT_CONFLICT')
        await tx.insert(orderEvent).values({
          id: crypto.randomUUID(),
          orderId,
          paymentId: savedPayment.id,
          eventType: 'payment.cod-collected',
          actorType: 'staff',
          actorId: staffActor.userId,
          metadata: { amountSatang },
        })
        const context = staffActor.auditContext ?? { requestId: orderId, ipAddress: null, userAgent: null }
        await recordOrderAudit(tx, {
          id: crypto.randomUUID(),
          actorUserId: staffActor.userId,
          action: 'order.cod-collected',
          targetType: 'commerce_order',
          targetId: orderId,
          ...context,
          metadata: { actorId: staffActor.userId, paymentId: savedPayment.id, amountSatang, operationId },
        })
        await issueReceiptInTransaction(tx, orderId, { type: 'staff', userId: staffActor.userId }, {
          operationId,
          auditContext: context,
        })
      } else if (savedPayment.status !== 'collected') {
        throw new DomainError('ORDER_PAYMENT_CONFLICT')
      }
      return commandResult(orderId, await readOrderDetail(tx, orderId))
    })
  }

  issueReceipt(orderId: string, staffActor: OrderStaffActor, key: string): Promise<OrderDetail> {
    assertOrderId(orderId)
    assertStaffActor(staffActor)
    return runOrderCommand(this.db, {
      scope: `staff:${staffActor.userId}`,
      command: 'issue-receipt',
      idempotencyKey: key,
      payload: { orderId },
    }, async (_tx, existing) => replayOrder(existing), async (tx, _requestHash, operationId) => {
      await lockOrder(tx, orderId)
      const outcome = await issueReceiptInTransaction(tx, orderId, { type: 'staff', userId: staffActor.userId }, {
        operationId,
        auditContext: staffActor.auditContext ?? { requestId: orderId, ipAddress: null, userAgent: null },
      })
      if (outcome === 'not_eligible') throw new DomainError('RECEIPT_NOT_ELIGIBLE')
      if (outcome === 'deferred') throw new DomainError('RECEIPT_SETTINGS_INCOMPLETE')
      return commandResult(orderId, await readOrderDetail(tx, orderId))
    })
  }

  cancelReceipt(orderId: string, reason: string, staffActor: OrderStaffActor, key: string): Promise<OrderDetail> {
    assertOrderId(orderId)
    assertStaffActor(staffActor)
    const cancelReason = typeof reason === 'string' ? reason.trim() : ''
    if (cancelReason.length < 1 || cancelReason.length > 300) throw new DomainError('INVALID_ORDER_COMMAND')
    return runOrderCommand(this.db, {
      scope: `staff:${staffActor.userId}`,
      command: 'cancel-receipt',
      idempotencyKey: key,
      payload: { orderId, reason: cancelReason },
    }, async (_tx, existing) => replayOrder(existing), async (tx, _requestHash, operationId) => {
      await lockOrder(tx, orderId)
      const [saved] = await tx.select({ id: receipt.id, status: receipt.status }).from(receipt)
        .where(eq(receipt.orderId, orderId)).for('update').limit(1)
      if (!saved) throw new DomainError('RECEIPT_NOT_FOUND')
      if (saved.status === 'cancelled') return commandResult(orderId, await readOrderDetail(tx, orderId))

      const [cancelled] = await tx.update(receipt).set({
        status: 'cancelled',
        cancelledAt: sql`transaction_timestamp()`,
        cancelledBy: staffActor.userId,
        cancelReason,
      }).where(and(eq(receipt.id, saved.id), eq(receipt.status, 'issued'))).returning({ id: receipt.id })
      if (!cancelled) throw new DomainError('INVALID_ORDER_COMMAND')

      await tx.insert(orderEvent).values({
        id: crypto.randomUUID(),
        orderId,
        eventType: 'receipt.cancelled',
        actorType: 'staff',
        actorId: staffActor.userId,
        reasonCode: 'staff_cancelled',
        metadata: { receiptId: saved.id, operationId },
      })
      const context = staffActor.auditContext ?? { requestId: orderId, ipAddress: null, userAgent: null }
      await recordOrderAudit(tx, {
        id: crypto.randomUUID(),
        actorUserId: staffActor.userId,
        action: 'order.receipt-cancelled',
        targetType: 'commerce_order',
        targetId: orderId,
        ...context,
        metadata: { actorId: staffActor.userId, receiptId: saved.id, operationId, reasonCode: 'staff_cancelled' },
      })
      return commandResult(orderId, await readOrderDetail(tx, orderId))
    })
  }

  reissueGuestAccess(
    orderId: string,
    reasonCode: string,
    staffActor: OrderStaffActor,
    key: string,
  ): Promise<OrderDetail> {
    assertOrderId(orderId)
    assertStaffActor(staffActor)
    assertGuestAccessReasonCode(reasonCode)
    const command = 'guest-access.reissue'
    return runOrderCommand(this.db, {
      scope: `staff:${staffActor.userId}`,
      command,
      idempotencyKey: key,
      payload: { orderId, reasonCode },
    }, async (_tx, existing) => replayOrder(existing), async (tx, _requestHash, operationId) => {
      const order = await lockOrder(tx, orderId)
      if (order.customerId !== null || !order.guestAccessTokenVersion) throw new DomainError('ORDER_NOT_FOUND')
      if (!this.commerceSecret || this.commerceSecret.byteLength < 32) throw new DomainError('INVALID_ORDER_COMMAND')

      const nonce = randomBytes(32).toString('base64url')
      const token = deriveGuestOrderToken(order.id, nonce, this.commerceSecret, order.guestAccessTokenVersion)
      await tx.update(commerceOrder).set({
        guestAccessTokenNonce: nonce,
        guestAccessTokenHash: hashGuestOrderToken(token),
      }).where(eq(commerceOrder.id, orderId))

      const eventId = crypto.randomUUID()
      await tx.insert(orderEvent).values({
        id: eventId,
        orderId,
        eventType: 'order.guest-access-reissued',
        actorType: 'staff',
        actorId: staffActor.userId,
        reasonCode,
        metadata: { operationId },
      })
      await tx.insert(orderOutbox).values({
        orderId,
        orderEventId: eventId,
        eventType: 'order.guest-access-reissued',
        templateId: 'order_confirmation',
      })
      const context = staffActor.auditContext ?? { requestId: orderId, ipAddress: null, userAgent: null }
      await recordOrderAudit(tx, {
        id: crypto.randomUUID(),
        actorUserId: staffActor.userId,
        action: 'order.guest-access-reissued',
        targetType: 'commerce_order',
        targetId: orderId,
        ...context,
        metadata: { actorId: staffActor.userId, reasonCode, operationId },
      })
      const detail = await readOrderDetail(tx, orderId)
      return commandResult(orderId, detail)
    })
  }

  revokeGuestAccess(
    orderId: string,
    reasonCode: string,
    staffActor: OrderStaffActor,
    key: string,
  ): Promise<OrderDetail> {
    assertOrderId(orderId)
    assertStaffActor(staffActor)
    assertGuestAccessReasonCode(reasonCode)
    const command = 'guest-access.revoke'
    return runOrderCommand(this.db, {
      scope: `staff:${staffActor.userId}`,
      command,
      idempotencyKey: key,
      payload: { orderId, reasonCode },
    }, async (_tx, existing) => replayOrder(existing), async (tx, _requestHash, operationId) => {
      const order = await lockOrder(tx, orderId)
      if (order.customerId !== null || !order.guestAccessTokenVersion) throw new DomainError('ORDER_NOT_FOUND')
      if (!this.commerceSecret || this.commerceSecret.byteLength < 32) throw new DomainError('INVALID_ORDER_COMMAND')

      const nonce = randomBytes(32).toString('base64url')
      const inaccessibleToken = deriveGuestOrderToken(order.id, nonce, this.commerceSecret, order.guestAccessTokenVersion)
      await tx.update(commerceOrder).set({
        guestAccessTokenNonce: nonce,
        guestAccessTokenHash: hashGuestOrderToken(inaccessibleToken),
      }).where(eq(commerceOrder.id, orderId))
      await tx.update(orderOutbox).set({
        status: 'failed',
        claimedAt: null,
        nextAttemptAt: new Date('9999-12-31T00:00:00.000Z'),
        lastErrorCode: 'ACCESS_REVOKED',
      }).where(and(
        eq(orderOutbox.orderId, orderId),
        inArray(orderOutbox.status, ['pending', 'processing', 'failed']),
      ))

      await tx.insert(orderEvent).values({
        id: crypto.randomUUID(),
        orderId,
        eventType: 'order.guest-access-revoked',
        actorType: 'staff',
        actorId: staffActor.userId,
        reasonCode,
        metadata: { operationId },
      })
      const context = staffActor.auditContext ?? { requestId: orderId, ipAddress: null, userAgent: null }
      await recordOrderAudit(tx, {
        id: crypto.randomUUID(),
        actorUserId: staffActor.userId,
        action: 'order.guest-access-revoked',
        targetType: 'commerce_order',
        targetId: orderId,
        ...context,
        metadata: { actorId: staffActor.userId, reasonCode, operationId },
      })
      const detail = await readOrderDetail(tx, orderId)
      return commandResult(orderId, detail)
    })
  }
}
