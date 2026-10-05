import type Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import type { Database } from '../../../database/types'
import { stripeCheckoutAttempt } from '../../../database/schema'
import { DomainError } from '../../../shared/domain-error'
import { cancelStripeOrderInTransaction, settleStripeOrderInTransaction } from '../../orders/service'
import { lockOrder, readOrderSnapshot } from '../../orders/repository'
import { STRIPE_CREATE_REQUEST_WINDOW_MS, type CheckoutSessionState, type StripeGateway, type StripeRefundState } from './gateway'
import { StripeRefundService } from './refunds'
import { StripePaymentRepository } from './repository'

export const STRIPE_ATTEMPT_CREATE_STALE_MS = 30 * 60 * 1000
export const STRIPE_IDEMPOTENCY_RECOVERY_MAX_AGE_MS = 23 * 60 * 60 * 1000
const STRIPE_PLANNED_EXPIRY_OFFSET_MS = 30 * 60 * 1000 + 2 * STRIPE_CREATE_REQUEST_WINDOW_MS

const supportedEvents = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'refund.created',
  'refund.updated',
  'refund.failed',
])

export class StripeSignatureError extends Error {
  constructor() {
    super('Invalid Stripe signature')
    this.name = 'StripeSignatureError'
  }
}

interface SessionEvidence {
  sessionId: string
  orderId: string | null
  clientReferenceId: string | null
  amountSatang: number | null
  currency: string | null
  status: CheckoutSessionState['status']
  paymentStatus: CheckoutSessionState['paymentStatus']
  paymentIntentId: string | null
  expiresAt: Date | null
  url: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asEventSession(value: unknown): SessionEvidence | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  const metadata = isRecord(value.metadata) ? value.metadata : null
  const paymentIntent = value.payment_intent
  const paymentIntentId = typeof paymentIntent === 'string'
    ? paymentIntent
    : isRecord(paymentIntent) && typeof paymentIntent.id === 'string' ? paymentIntent.id : null
  const status = value.status === 'open' || value.status === 'complete' || value.status === 'expired'
    ? value.status
    : null
  const paymentStatus = value.payment_status === 'paid'
    || value.payment_status === 'unpaid'
    || value.payment_status === 'no_payment_required'
    ? value.payment_status
    : null

  return {
    sessionId: value.id,
    orderId: metadata && typeof metadata.orderId === 'string' ? metadata.orderId : null,
    clientReferenceId: typeof value.client_reference_id === 'string' ? value.client_reference_id : null,
    amountSatang: typeof value.amount_total === 'number' ? value.amount_total : null,
    currency: typeof value.currency === 'string' ? value.currency : null,
    status,
    paymentStatus,
    paymentIntentId,
    expiresAt: typeof value.expires_at === 'number' ? new Date(value.expires_at * 1000) : null,
    url: typeof value.url === 'string' && value.url.startsWith('https://') ? value.url : null,
  }
}

function asRetrievedSession(value: CheckoutSessionState): SessionEvidence {
  return {
    sessionId: value.sessionId,
    orderId: value.orderId,
    clientReferenceId: value.orderId,
    amountSatang: value.amountSatang,
    currency: value.currency,
    status: value.status,
    paymentStatus: value.paymentStatus,
    paymentIntentId: value.paymentIntentId,
    expiresAt: value.expiresAt,
    url: null,
  }
}

function asEventRefund(value: unknown): StripeRefundState | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.amount !== 'number'
    || typeof value.currency !== 'string') return null
  const metadata = isRecord(value.metadata) ? value.metadata : null
  const paymentIntent = value.payment_intent
  const paymentIntentId = typeof paymentIntent === 'string'
    ? paymentIntent
    : isRecord(paymentIntent) && typeof paymentIntent.id === 'string' ? paymentIntent.id : null
  const status = value.status === 'requires_action' || value.status === 'succeeded'
    || value.status === 'failed' || value.status === 'canceled' || value.status === 'pending'
    ? value.status
    : null
  if (!status) return null
  return {
    refundId: value.id,
    orderId: metadata && typeof metadata.orderId === 'string' ? metadata.orderId : null,
    refundClaimId: metadata && typeof metadata.refundClaimId === 'string' ? metadata.refundClaimId : null,
    paymentIntentId,
    amountSatang: value.amount,
    currency: value.currency,
    status,
  }
}

export class StripeEventService {
  private readonly repository: StripePaymentRepository
  private readonly refunds: StripeRefundService

  constructor(private readonly db: Database, private readonly gateway: StripeGateway | null) {
    this.repository = new StripePaymentRepository(db)
    this.refunds = new StripeRefundService(db, gateway)
  }

  async handle(rawBody: string, signature: string): Promise<void> {
    if (!signature) throw new StripeSignatureError()
    if (!this.gateway) throw new DomainError('STRIPE_NOT_CONFIGURED')
    let event: Stripe.Event
    try {
      event = this.gateway.constructEvent(rawBody, signature)
    } catch {
      throw new StripeSignatureError()
    }
    if (!supportedEvents.has(event.type)) return

    if (event.type.startsWith('refund.')) {
      const refund = asEventRefund(event.data.object)
      if (refund) await this.refunds.applyRefundState(refund, { id: event.id, type: event.type })
      return
    }

    const session = asEventSession(event.data.object)
    if (!session) return
    let currentState: SessionEvidence | null = session
    if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
      try {
        currentState = asRetrievedSession(await this.gateway.retrieveCheckout(session.sessionId))
      } catch {
        throw new Error('Stripe Checkout state could not be retrieved')
      }
    }

    await this.applyEvent(event.id, event.type, session, currentState)
  }

  async reconcileAttempts(limit: number): Promise<number> {
    if (!this.gateway || !Number.isFinite(limit) || limit <= 0) return 0
    const now = Date.now()
    const staleExpiryBefore = new Date(now - STRIPE_CREATE_REQUEST_WINDOW_MS)
    const legacyCallBefore = new Date(now - STRIPE_ATTEMPT_CREATE_STALE_MS - STRIPE_CREATE_REQUEST_WINDOW_MS)
    const attempts = await this.repository.listUnresolvedAttempts(
      Math.min(1000, Math.floor(limit)),
      staleExpiryBefore,
      legacyCallBefore,
    )
    let reconciled = 0
    for (const attempt of attempts) {
      try {
        await this.db.transaction((tx) => this.repository.markAttemptReconciled(tx, attempt.id))
      } catch (error) {
        console.error(JSON.stringify({
          level: 'error',
          code: 'STRIPE_CHECKOUT_RECONCILIATION_CURSOR_FAILED',
          errorCategory: error instanceof Error ? error.name : 'unknown',
          attemptId: attempt.id,
          orderId: attempt.orderId,
        }))
      }
      try {
        if (!attempt.stripeSessionId) {
          await this.recoverUnboundAttempt(attempt.id, staleExpiryBefore, legacyCallBefore)
          reconciled += 1
          continue
        }
        const current = asRetrievedSession(await this.gateway.retrieveCheckout(attempt.stripeSessionId))
        await this.applyEvent(`reconcile:${attempt.id}`, 'reconciliation', current, current)
        reconciled += 1
      } catch (error) {
        console.error(JSON.stringify({
          level: 'error',
          code: 'STRIPE_CHECKOUT_RECONCILIATION_FAILED',
          errorCategory: error instanceof Error ? error.name : 'unknown',
          attemptId: attempt.id,
          orderId: attempt.orderId,
        }))
      }
    }
    return reconciled
  }

  private async recoverUnboundAttempt(
    attemptId: string,
    staleExpiryBefore: Date,
    legacyCallBefore: Date,
  ): Promise<void> {
    if (!this.gateway) return
    const recovery = await this.db.transaction(async (tx) => {
      const [candidate] = await tx.select({ orderId: stripeCheckoutAttempt.orderId })
        .from(stripeCheckoutAttempt)
        .where(eq(stripeCheckoutAttempt.id, attemptId))
        .limit(1)
      if (!candidate) return
      const attempt = await this.repository.lockAttemptByOrder(tx, candidate.orderId)
      if (!attempt || attempt.id !== attemptId || attempt.status !== 'creating'
        || attempt.stripeSessionId) return
      const stale = attempt.plannedExpiresAt
        ? attempt.plannedExpiresAt <= staleExpiryBefore
        : attempt.lastCreateCallAt <= legacyCallBefore
      if (!stale) return null

      const order = await lockOrder(tx, attempt.orderId)
      const savedPayment = await this.repository.lockPaymentByOrder(tx, attempt.orderId)
      if (!savedPayment || order.paymentMethod !== 'stripe'
        || order.status !== 'pending_payment' || savedPayment.status !== 'awaiting_collection') return null
      const plannedFirstCallAt = attempt.plannedExpiresAt
        ? attempt.plannedExpiresAt.getTime() - STRIPE_PLANNED_EXPIRY_OFFSET_MS - 1000
        : attempt.lastCreateCallAt.getTime()
      if (plannedFirstCallAt <= Date.now() - STRIPE_IDEMPOTENCY_RECOVERY_MAX_AGE_MS) {
        await this.repository.markAttemptManualReview(tx, attempt.id)
        return { manualReview: true as const, attemptId: attempt.id, orderId: order.id }
      }
      const snapshot = await readOrderSnapshot(tx, order.id)
      if (!attempt.plannedExpiresAt || !attempt.successUrl || !attempt.cancelUrl) {
        await this.repository.markAttemptManualReview(tx, attempt.id)
        return { manualReview: true as const, attemptId: attempt.id, orderId: order.id }
      }
      return {
        manualReview: false as const,
        attemptId: attempt.id,
        orderId: order.id,
        input: {
          orderId: order.id,
          lines: snapshot.items.map((item) => ({
            name: `${item.productName} · ${item.variantName}`,
            quantity: item.quantity,
            unitAmountSatang: item.unitPriceSatang,
          })),
          shippingSatang: snapshot.shippingSatang,
          email: snapshot.contactEmail,
          amountSatang: snapshot.totalSatang,
          currency: 'thb' as const,
          expiresAt: attempt.plannedExpiresAt,
          successUrl: attempt.successUrl,
          cancelUrl: attempt.cancelUrl,
          idempotencyKey: attempt.stripeIdempotencyKey,
        },
      }
    })
    if (!recovery) return
    if (recovery.manualReview) {
      this.logManualReview(recovery.attemptId, recovery.orderId)
      return
    }

    let session: Awaited<ReturnType<StripeGateway['createCheckout']>>
    try {
      session = await this.gateway.createCheckout(recovery.input)
    } catch {
      await this.markManualReview(recovery.attemptId, recovery.orderId)
      return
    }

    const saved = await this.db.transaction((tx) => this.repository.recordAttemptSession(tx, recovery.attemptId, {
      sessionId: session.sessionId,
      url: session.url,
      expiresAt: session.expiresAt,
    }))
    if (!saved) {
      await this.markManualReview(recovery.attemptId, recovery.orderId)
      return
    }

    let current: SessionEvidence
    try {
      current = asRetrievedSession(await this.gateway.retrieveCheckout(session.sessionId))
    } catch {
      return
    }
    const matchesRequest = current.sessionId === session.sessionId
      && current.orderId === recovery.orderId
      && current.amountSatang === recovery.input.amountSatang
      && current.currency?.toLowerCase() === 'thb'
      && current.status !== null
      && current.paymentStatus !== null
    if (!matchesRequest) {
      await this.markManualReview(recovery.attemptId, recovery.orderId)
      return
    }
    await this.applyEvent(`reconcile:${recovery.attemptId}`, 'reconciliation', current, current)
  }

  private async markManualReview(attemptId: string, orderId: string) {
    const marked = await this.db.transaction(async (tx) => {
      const attempt = await this.repository.lockAttemptByOrder(tx, orderId)
      if (!attempt || attempt.id !== attemptId || attempt.status !== 'creating'
        || attempt.stripeSessionId) return false
      const order = await lockOrder(tx, orderId)
      const savedPayment = await this.repository.lockPaymentByOrder(tx, orderId)
      if (!savedPayment || order.paymentMethod !== 'stripe'
        || order.status !== 'pending_payment' || savedPayment.status !== 'awaiting_collection') return false
      await this.repository.markAttemptManualReview(tx, attemptId)
      return true
    })
    if (marked) this.logManualReview(attemptId, orderId)
  }

  private logManualReview(attemptId: string, orderId: string) {
    console.error(JSON.stringify({
      level: 'error',
      code: 'STRIPE_CHECKOUT_ATTEMPT_MANUAL_REVIEW_REQUIRED',
      attemptId,
      orderId,
    }))
  }

  private async applyEvent(
    eventId: string,
    eventType: string,
    eventSession: SessionEvidence,
    currentState: SessionEvidence | null,
  ) {
    const manualReview = await this.db.transaction(async (tx) => {
      const possibleOrderId = eventSession.orderId ?? currentState?.orderId
      let attempt = await this.repository.lockAttemptBySession(tx, eventSession.sessionId)
      if (!attempt && possibleOrderId) attempt = await this.repository.lockAttemptByOrder(tx, possibleOrderId)
      if (!attempt) {
        if (eventType !== 'reconciliation') await this.repository.claimEvent(tx, eventId, eventType)
        return
      }

      const order = await lockOrder(tx, attempt.orderId)
      const savedPayment = await this.repository.lockPaymentByOrder(tx, attempt.orderId)
      if (!savedPayment) throw new DomainError('ORDER_PAYMENT_CONFLICT')

      if (eventType !== 'reconciliation') {
        const claimed = await this.repository.claimEvent(tx, eventId, eventType)
        if (!claimed) return
      }

      const candidate = currentState ?? eventSession
      const validIdentity = eventSession.sessionId === candidate.sessionId
        && candidate.sessionId.length > 0
        && candidate.orderId === order.id
        && candidate.clientReferenceId === order.id
        && (eventSession.orderId === null || eventSession.orderId === order.id)
        && (eventSession.clientReferenceId === null || eventSession.clientReferenceId === order.id)
        && attempt.orderId === order.id
        && (!attempt.stripeSessionId || attempt.stripeSessionId === candidate.sessionId)
        && order.paymentMethod === 'stripe'
        && savedPayment.method === 'stripe'
        && savedPayment.provider === 'stripe'
        && candidate.amountSatang === order.totalSatang
        && candidate.amountSatang === savedPayment.amountSatang
        && candidate.currency?.toLowerCase() === 'thb'
        && savedPayment.currency === 'THB'
      if (!validIdentity) return

      if (!attempt.stripeSessionId) {
        const bound = await this.repository.recordAttemptSession(tx, attempt.id, {
          sessionId: eventSession.sessionId,
          url: eventSession.url,
          expiresAt: eventSession.expiresAt,
        })
        if (!bound) throw new Error('Stripe Checkout attempt could not be bound')
        attempt = bound
      }

      const paid = candidate.paymentStatus === 'paid'
      const successfulSignal = eventType === 'checkout.session.completed'
        || eventType === 'checkout.session.async_payment_succeeded'
        || eventType === 'reconciliation'
      if (paid && (successfulSignal || eventType === 'checkout.session.async_payment_failed'
        || eventType === 'checkout.session.expired')) {
        const settled = await settleStripeOrderInTransaction(tx, {
          order,
          payment: savedPayment,
          eventId,
          sessionId: candidate.sessionId,
          paymentIntentId: candidate.paymentIntentId,
        })
        if (!settled && order.status === 'pending_payment') {
          await this.repository.markAttemptManualReview(tx, attempt.id)
          return { attemptId: attempt.id, orderId: order.id }
        }
        await this.repository.markAttemptStatus(tx, attempt.id, 'completed')
        return
      }

      if (eventType === 'checkout.session.completed' && candidate.paymentStatus !== 'paid') {
        return
      }

      const failed = eventType === 'checkout.session.async_payment_failed'
        && candidate.status === 'complete'
        && candidate.paymentStatus === 'unpaid'
      const expired = (eventType === 'checkout.session.expired' || eventType === 'reconciliation')
        && candidate.status === 'expired'
        && candidate.paymentStatus !== 'paid'
      if (failed || expired) {
        await cancelStripeOrderInTransaction(tx, {
          order,
          payment: savedPayment,
          eventId,
          sessionId: candidate.sessionId,
          reason: expired ? 'stripe_session_expired' : 'stripe_payment_failed',
        })
        await this.repository.markAttemptStatus(tx, attempt.id, expired ? 'expired' : 'failed')
        return
      }

    })
    if (manualReview) this.logManualReview(manualReview.attemptId, manualReview.orderId)
  }
}
