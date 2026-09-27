import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../../database/types'
import { auditLog, orderEvent, payment, stripeRefund } from '../../../database/schema'
import { assertAuditMetadata, type AuditEvent } from '../../audit/model'
import type { OrderDetail, OrderStaffActor } from '../../orders/types'
import { lockOrder, readOrderDetail } from '../../orders/repository'
import { runOrderCommand, type OrderCommandResult } from '../../orders/operation'
import { DomainError } from '../../../shared/domain-error'
import type { StripeGateway, StripeRefundState, StripeRefundStatus } from './gateway'
import { StripePaymentRepository } from './repository'

const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertStaff(actor: OrderStaffActor): void {
  if (!actor || actor.kind !== 'staff' || typeof actor.userId !== 'string' || !actor.userId.trim()) {
    throw new DomainError('ORDER_ACCESS_DENIED')
  }
}

function requestContext(actor: OrderStaffActor, orderId: string) {
  return actor.auditContext ?? { requestId: orderId, ipAddress: null, userAgent: null }
}

function commandResult(orderId: string, detail: Awaited<ReturnType<typeof readOrderDetail>>): OrderCommandResult<typeof detail> {
  return { orderId, httpStatus: 200, resultPayload: { order: detail as unknown as Record<string, unknown> }, value: detail }
}

function checkedStripeState(
  refund: StripeRefundState,
  claim: typeof stripeRefund.$inferSelect,
  paymentIntentId: string | null,
  orderId: string,
): boolean {
  return refund.refundId === claim.stripeRefundId
    && refund.paymentIntentId === paymentIntentId
    && refund.amountSatang === claim.amountSatang
    && refund.currency.toLowerCase() === 'thb'
    && (!refund.orderId || refund.orderId === orderId)
    && (!refund.refundClaimId || refund.refundClaimId === claim.id)
    && (refund.status === 'failed' || refund.status === 'canceled')
}

function canApplyRefundStatus(current: StripeRefundStatus, next: StripeRefundStatus) {
  const terminal = new Set<StripeRefundStatus>(['succeeded', 'failed', 'canceled'])
  if (terminal.has(current)) return current === next
  if (current === 'requires_action' && next === 'pending') return false
  return true
}

export class StripeRefundService {
  private readonly repository: StripePaymentRepository

  constructor(private readonly db: Database, private readonly gateway: StripeGateway | null) {
    this.repository = new StripePaymentRepository(db)
  }

  async requestFullRefund(orderId: string, actor: OrderStaffActor, idempotencyKey: string): Promise<OrderDetail> {
    assertStaff(actor)
    if (!orderIdPattern.test(orderId)) throw new DomainError('ORDER_NOT_FOUND')
    if (!this.gateway) throw new DomainError('STRIPE_NOT_CONFIGURED')

    const priorFailures = await this.db.transaction(async (tx) => {
      await lockOrder(tx, orderId)
      const [savedPayment] = await tx.select().from(payment)
        .where(eq(payment.orderId, orderId)).for('update').limit(1)
      if (!savedPayment) throw new DomainError('ORDER_PAYMENT_CONFLICT')
      const claims = await this.repository.lockRefundsByPayment(tx, savedPayment.id)
      return {
        paymentIntentId: savedPayment.providerReference,
        claims: claims.filter((claim) => claim.status === 'failed' || claim.status === 'canceled')
          .filter((claim) => claim.idempotencyKey !== idempotencyKey && claim.stripeRefundId !== null),
      }
    })

    const verifiedFailures = new Set<string>()
    for (const claim of priorFailures.claims) {
      let current: StripeRefundState
      try {
        current = await this.gateway.retrieveRefund(claim.stripeRefundId!)
      } catch {
        throw new DomainError('ORDER_REFUND_CONFLICT')
      }
      if (!checkedStripeState(current, claim, priorFailures.paymentIntentId, orderId)) {
        throw new DomainError('ORDER_REFUND_CONFLICT')
      }
      verifiedFailures.add(claim.id)
    }

    let claimId: string | undefined
    let shouldSubmit = false
    await runOrderCommand(this.db, {
      scope: `order:${orderId}:stripe-refund`,
      command: 'request-full-refund',
      idempotencyKey,
      payload: { orderId },
    }, async (tx) => readOrderDetail(tx, orderId), async (tx, _requestHash, operationId) => {
      const order = await lockOrder(tx, orderId)
      const [savedPayment] = await tx.select().from(payment)
        .where(eq(payment.orderId, orderId)).for('update').limit(1)
      if (!savedPayment) throw new DomainError('ORDER_PAYMENT_CONFLICT')
      if (order.status !== 'cancelled') throw new DomainError('INVALID_ORDER_TRANSITION')
      if (order.paymentMethod !== 'stripe' || savedPayment.method !== 'stripe'
        || savedPayment.provider !== 'stripe' || savedPayment.status !== 'collected'
        || !savedPayment.providerReference) {
        throw new DomainError('ORDER_PAYMENT_CONFLICT')
      }
      if (!Number.isSafeInteger(order.totalSatang) || order.totalSatang < 1
        || savedPayment.amountSatang !== order.totalSatang) {
        throw new DomainError('ORDER_PAYMENT_CONFLICT')
      }

      const claims = await this.repository.lockRefundsByPayment(tx, savedPayment.id)
      const sameKey = claims.find((claim) => claim.idempotencyKey === idempotencyKey)
      const active = claims.find((claim) => ['pending', 'requires_action', 'succeeded'].includes(claim.status))
      if (active && active.id !== sameKey?.id) throw new DomainError('ORDER_REFUND_CONFLICT')

      for (const prior of claims.filter((claim) => claim.status === 'failed' || claim.status === 'canceled')) {
        if (prior.idempotencyKey === idempotencyKey) continue
        if (!verifiedFailures.has(prior.id)) throw new DomainError('ORDER_REFUND_CONFLICT')
      }

      let refund = sameKey
      if (!refund) {
        const stableKey = `stripe-refund-${createHash('sha256').update(`${orderId}:${idempotencyKey}`).digest('hex')}`
        const created = await this.repository.createRefundClaim(tx, {
          paymentId: savedPayment.id,
          orderId,
          requestActorType: 'staff',
          requestActorId: actor.userId,
          idempotencyKey,
          stripeIdempotencyKey: stableKey,
          amountSatang: order.totalSatang,
        })
        refund = created.refund
      }
      if (refund.status === 'pending' && !refund.stripeRefundId) {
        claimId = refund.id
        shouldSubmit = true
      } else {
        claimId = refund.id
      }

      if (!sameKey) {
        const context = requestContext(actor, orderId)
        await tx.insert(orderEvent).values({
          id: crypto.randomUUID(),
          orderId,
          paymentId: savedPayment.id,
          eventType: 'payment.stripe-refund-requested',
          actorType: 'staff',
          actorId: actor.userId,
          reasonCode: 'admin_full_refund',
          metadata: {
            operationId,
            refundId: refund.id,
            amountSatang: refund.amountSatang,
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        })
        const audit: AuditEvent = {
          id: crypto.randomUUID(),
          actorUserId: actor.userId,
          action: 'order.stripe-refund-requested',
          targetType: 'commerce_order',
          targetId: orderId,
          ...context,
          metadata: { operationId, refundId: refund.id, amountSatang: refund.amountSatang },
        }
        assertAuditMetadata(audit)
        await tx.insert(auditLog).values(audit)
      }

      return commandResult(orderId, await readOrderDetail(tx, orderId))
    })

    if (!claimId) {
      const [savedPayment] = await this.db.select().from(payment).where(eq(payment.orderId, orderId)).limit(1)
      if (!savedPayment) throw new DomainError('ORDER_PAYMENT_CONFLICT')
      const [claim] = await this.db.select().from(stripeRefund).where(and(
        eq(stripeRefund.paymentId, savedPayment.id),
        eq(stripeRefund.idempotencyKey, idempotencyKey),
      )).limit(1)
      if (!claim) throw new DomainError('ORDER_REFUND_CONFLICT')
      claimId = claim.id
      shouldSubmit = claim.status === 'pending' && claim.stripeRefundId === null
    }

    if (shouldSubmit) {
      const claim = await this.db.transaction((tx) => this.repository.lockRefundById(tx, claimId!))
      if (!claim) throw new DomainError('ORDER_REFUND_CONFLICT')
      const [savedPayment] = await this.db.select({ providerReference: payment.providerReference })
        .from(payment).where(eq(payment.id, claim.paymentId)).limit(1)
      if (!savedPayment?.providerReference) throw new DomainError('ORDER_PAYMENT_CONFLICT')
      let providerState: StripeRefundState
      try {
        providerState = await this.gateway.createFullRefund({
          orderId,
          refundClaimId: claim.id,
          paymentIntentId: savedPayment.providerReference,
          idempotencyKey: claim.stripeIdempotencyKey,
        })
      } catch {
        throw new DomainError('STRIPE_REFUND_UNAVAILABLE')
      }
      if (providerState.orderId !== orderId || providerState.refundClaimId !== claim.id
        || providerState.paymentIntentId !== savedPayment.providerReference
        || providerState.amountSatang !== claim.amountSatang
        || providerState.currency.toLowerCase() !== 'thb') {
        throw new DomainError('ORDER_REFUND_CONFLICT')
      }
      await this.db.transaction(async (tx) => {
        const current = await this.repository.lockRefundById(tx, claim.id)
        if (!current) throw new DomainError('ORDER_REFUND_CONFLICT')
        if (current.stripeRefundId && current.stripeRefundId !== providerState.refundId) {
          throw new DomainError('ORDER_REFUND_CONFLICT')
        }
        if (canApplyRefundStatus(current.status, providerState.status)) {
          await this.repository.recordRefundState(tx, current.id, {
            stripeRefundId: providerState.refundId,
            status: providerState.status,
          })
        }
      })
    }

    return this.db.transaction((tx) => readOrderDetail(tx, orderId))
  }

  async reconcileRefunds(limit: number): Promise<number> {
    if (!this.gateway || !Number.isFinite(limit) || limit <= 0) return 0
    const refunds = await this.repository.listUnresolvedRefunds(Math.min(1000, Math.floor(limit)))
    let reconciled = 0
    for (const claim of refunds) {
      if (!claim.stripeRefundId) continue
      try {
        await this.db.transaction((tx) => this.repository.markRefundReconciled(tx, claim.id))
      } catch (error) {
        console.error(JSON.stringify({
          level: 'error',
          code: 'STRIPE_REFUND_RECONCILIATION_CURSOR_FAILED',
          errorCategory: error instanceof Error ? error.name : 'unknown',
          refundClaimId: claim.id,
          orderId: claim.orderId,
        }))
      }
      try {
        const current = await this.gateway.retrieveRefund(claim.stripeRefundId)
        await this.applyRefundState(current)
        reconciled += 1
      } catch (error) {
        console.error(JSON.stringify({
          level: 'error',
          code: 'STRIPE_REFUND_RECONCILIATION_FAILED',
          errorCategory: error instanceof Error ? error.name : 'unknown',
          refundClaimId: claim.id,
          orderId: claim.orderId,
        }))
      }
    }
    return reconciled
  }

  async applyRefundState(state: StripeRefundState, event?: { id: string; type: string }) {
    return this.db.transaction(async (tx: DatabaseTransaction) => {
      const candidate = state.refundClaimId
        ? await this.repository.findRefundById(tx, state.refundClaimId)
        : await this.repository.findRefundByStripeId(tx, state.refundId)
      if (!candidate) {
        if (event) await this.repository.claimEvent(tx, event.id, event.type)
        return false
      }
      const order = await lockOrder(tx, candidate.orderId)
      const claim = await this.repository.lockRefundById(tx, candidate.id)
      if (!claim || claim.orderId !== candidate.orderId || claim.paymentId !== candidate.paymentId
        || (claim.stripeRefundId && claim.stripeRefundId !== state.refundId)) {
        if (event) await this.repository.claimEvent(tx, event.id, event.type)
        return false
      }
      const [savedPayment] = await tx.select().from(payment).where(eq(payment.id, claim.paymentId)).limit(1)
      const validState = savedPayment?.providerReference === state.paymentIntentId
        && savedPayment.method === 'stripe'
        && order.paymentMethod === 'stripe'
        && order.totalSatang === claim.amountSatang
        && savedPayment.amountSatang === claim.amountSatang
        && state.amountSatang === claim.amountSatang
        && state.currency.toLowerCase() === 'thb'
        && (!state.orderId || state.orderId === order.id)
        && (!state.refundClaimId || state.refundClaimId === claim.id)
      if (!validState) {
        if (event) await this.repository.claimEvent(tx, event.id, event.type)
        return false
      }
      if (event && !(await this.repository.claimEvent(tx, event.id, event.type))) return false
      if (!canApplyRefundStatus(claim.status, state.status)) return false
      await this.repository.recordRefundState(tx, claim.id, {
        stripeRefundId: state.refundId,
        status: state.status as StripeRefundStatus,
      })
      await tx.insert(orderEvent).values({
        id: crypto.randomUUID(),
        orderId: order.id,
        paymentId: claim.paymentId,
        eventType: 'payment.stripe-refund-status-changed',
        actorType: 'system',
        actorId: null,
        reasonCode: state.status,
        metadata: { refundId: claim.id, stripeRefundId: state.refundId, stripeEventId: event?.id ?? null },
      })
      return true
    })
  }
}
