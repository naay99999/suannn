import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../../database/types'
import { stripeCheckoutAttempt, stripeEvent, stripeRefund } from '../../../database/schema'

export interface CreateStripeCheckoutAttemptInput {
  orderId: string
  stripeIdempotencyKey: string
}

export interface CreateStripeRefundClaimInput {
  paymentId: string
  orderId: string
  requestActorType: 'staff' | 'system'
  requestActorId: string | null
  idempotencyKey: string
  stripeIdempotencyKey: string
  amountSatang: number
}

export class StripePaymentRepository {
  constructor(private readonly db: Database) {}

  async createAttempt(tx: DatabaseTransaction, input: CreateStripeCheckoutAttemptInput) {
    const [created] = await tx.insert(stripeCheckoutAttempt).values(input)
      .onConflictDoNothing({ target: stripeCheckoutAttempt.orderId })
      .returning()
    if (created) return created

    const [existing] = await tx.select().from(stripeCheckoutAttempt)
      .where(eq(stripeCheckoutAttempt.orderId, input.orderId)).limit(1)
    if (!existing) throw new Error('Stripe Checkout attempt could not be created')
    return existing
  }

  async lockAttemptByOrder(tx: DatabaseTransaction, orderId: string) {
    const [attempt] = await tx.select().from(stripeCheckoutAttempt)
      .where(eq(stripeCheckoutAttempt.orderId, orderId)).for('update').limit(1)
    return attempt ?? null
  }

  async lockAttemptBySession(tx: DatabaseTransaction, sessionId: string) {
    const [attempt] = await tx.select().from(stripeCheckoutAttempt)
      .where(eq(stripeCheckoutAttempt.stripeSessionId, sessionId)).for('update').limit(1)
    return attempt ?? null
  }

  async claimEvent(tx: DatabaseTransaction, eventId: string, eventType: string) {
    const [claimed] = await tx.insert(stripeEvent)
      .values({ stripeEventId: eventId, eventType })
      .onConflictDoNothing({ target: stripeEvent.stripeEventId })
      .returning({ stripeEventId: stripeEvent.stripeEventId })
    return claimed !== undefined
  }

  async createRefundClaim(tx: DatabaseTransaction, input: CreateStripeRefundClaimInput) {
    const [created] = await tx.insert(stripeRefund).values(input)
      .onConflictDoNothing({ target: [stripeRefund.paymentId, stripeRefund.idempotencyKey] })
      .returning()
    if (created) return { refund: created, replayed: false }

    const [existing] = await tx.select().from(stripeRefund).where(and(
      eq(stripeRefund.paymentId, input.paymentId),
      eq(stripeRefund.idempotencyKey, input.idempotencyKey),
    )).limit(1)
    if (!existing) throw new Error('Stripe Refund claim could not be created')
    return { refund: existing, replayed: true }
  }

  async lockRefundByStripeId(tx: DatabaseTransaction, refundId: string) {
    const [refund] = await tx.select().from(stripeRefund)
      .where(eq(stripeRefund.stripeRefundId, refundId)).for('update').limit(1)
    return refund ?? null
  }

  async listUnresolvedAttempts(limit: number) {
    return this.db.select().from(stripeCheckoutAttempt)
      .where(inArray(stripeCheckoutAttempt.status, ['creating', 'open']))
      .orderBy(asc(stripeCheckoutAttempt.lastCreateCallAt), asc(stripeCheckoutAttempt.createdAt))
      .limit(Math.max(0, Math.floor(limit)))
  }

  async listUnresolvedRefunds(limit: number) {
    return this.db.select().from(stripeRefund)
      .where(inArray(stripeRefund.status, ['pending', 'requires_action']))
      .orderBy(asc(stripeRefund.updatedAt), asc(stripeRefund.createdAt))
      .limit(Math.max(0, Math.floor(limit)))
  }

  async recordAttemptSession(tx: DatabaseTransaction, attemptId: string, input: {
    sessionId: string
    url: string
    expiresAt: Date
  }) {
    const [attempt] = await tx.update(stripeCheckoutAttempt).set({
      stripeSessionId: input.sessionId,
      checkoutUrl: input.url,
      expiresAt: input.expiresAt,
      status: 'open',
      updatedAt: new Date(),
    }).where(eq(stripeCheckoutAttempt.id, attemptId)).returning()
    return attempt ?? null
  }

  async markAttemptStatus(tx: DatabaseTransaction, attemptId: string, status: 'completed' | 'expired' | 'failed') {
    const [attempt] = await tx.update(stripeCheckoutAttempt)
      .set({ status, updatedAt: new Date() })
      .where(eq(stripeCheckoutAttempt.id, attemptId)).returning()
    return attempt ?? null
  }

  async touchAttemptCreateCall(tx: DatabaseTransaction, attemptId: string, calledAt = new Date()) {
    const [attempt] = await tx.update(stripeCheckoutAttempt)
      .set({ lastCreateCallAt: calledAt, updatedAt: calledAt })
      .where(eq(stripeCheckoutAttempt.id, attemptId)).returning()
    return attempt ?? null
  }

  async recordRefundState(tx: DatabaseTransaction, id: string, state: {
    stripeRefundId: string | null
    status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled'
  }) {
    const [refund] = await tx.update(stripeRefund).set({ ...state, updatedAt: new Date() })
      .where(eq(stripeRefund.id, id)).returning()
    return refund ?? null
  }
}
