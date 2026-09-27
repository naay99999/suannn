import type Stripe from 'stripe'
import type { Database } from '../../../database/types'
import { DomainError } from '../../../shared/domain-error'
import { cancelStripeOrderInTransaction, settleStripeOrderInTransaction } from '../../orders/service'
import { lockOrder } from '../../orders/repository'
import type { CheckoutSessionState, StripeGateway } from './gateway'
import type { StripeRefundState } from './gateway'
import { StripeRefundService } from './refunds'
import { StripePaymentRepository } from './repository'

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
    const attempts = await this.repository.listUnresolvedAttempts(Math.min(1000, Math.floor(limit)))
    let reconciled = 0
    for (const attempt of attempts) {
      if (!attempt.stripeSessionId) continue
      const current = asRetrievedSession(await this.gateway.retrieveCheckout(attempt.stripeSessionId))
      await this.applyEvent(`reconcile:${attempt.id}`, 'reconciliation', current, current)
      reconciled += 1
    }
    return reconciled
  }

  private async applyEvent(
    eventId: string,
    eventType: string,
    eventSession: SessionEvidence,
    currentState: SessionEvidence | null,
  ) {
    await this.db.transaction(async (tx) => {
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
        await settleStripeOrderInTransaction(tx, {
          order,
          payment: savedPayment,
          eventId,
          sessionId: candidate.sessionId,
          paymentIntentId: candidate.paymentIntentId,
        })
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
  }
}
