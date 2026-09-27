import type { Database } from '../../database/types'
import { DomainError } from '../../shared/domain-error'
import type { CartPrincipal } from '../cart/types'
import type { PlaceStripeInput, OrderSnapshot } from '../orders/types'
import { runOrderCommand } from '../orders/operation'
import type { StripeGateway } from '../payments/stripe/gateway'
import { StripePaymentRepository } from '../payments/stripe/repository'
import {
  createPlaceOrderInTransaction,
  normalizeCheckoutInput,
  placementResultPayload,
  replayPlacedOrderRecord,
  type PlacedOrderRecord,
} from './placement'
import { principalScope } from './service'

export interface StripeCheckoutResult {
  order: OrderSnapshot
  checkout: { url: string; expiresAt: string }
  guestAccessToken?: string
}

export class StripeCheckoutService {
  private readonly stripePayments: StripePaymentRepository
  private readonly placeOrderInTransaction

  constructor(
    private readonly db: Database,
    private readonly secret: Uint8Array,
    private readonly gateway: StripeGateway | null,
    nowOverride?: () => Date,
  ) {
    this.stripePayments = new StripePaymentRepository(db)
    this.placeOrderInTransaction = createPlaceOrderInTransaction(secret, this.stripePayments, nowOverride)
  }

  async place(input: PlaceStripeInput, principal: CartPrincipal, idempotencyKey: string): Promise<StripeCheckoutResult> {
    if (!this.gateway) throw new DomainError('STRIPE_NOT_CONFIGURED')
    const normalized = normalizeCheckoutInput(input)
    const payload = {
      quoteToken: normalized.quoteToken,
      paymentMethod: normalized.paymentMethod,
      contact: normalized.contact,
      address: normalized.address,
    }
    const record = await runOrderCommand<PlacedOrderRecord>(this.db, {
      scope: principalScope(principal),
      command: 'checkout.place-stripe',
      idempotencyKey,
      payload,
    }, async (_tx, operation) => {
      const replayed = replayPlacedOrderRecord(operation, principal, this.secret)
      if (replayed.order.status !== 'pending_payment'
        || replayed.order.paymentMethod !== 'stripe'
        || !replayed.attemptId) {
        throw new DomainError('INVALID_ORDER_COMMAND')
      }
      return replayed
    }, async (tx, requestHash) => {
      const placed = await this.placeOrderInTransaction(tx, normalized, principal, requestHash, 'stripe')
      if (!placed.attemptId) throw new DomainError('INVALID_ORDER_COMMAND')
      return {
        orderId: placed.order.id,
        httpStatus: 201,
        resultPayload: placementResultPayload(placed),
        value: placed,
      }
    })
    if (!record.attemptId || record.order.status !== 'pending_payment') {
      throw new DomainError('INVALID_ORDER_COMMAND')
    }

    const attempt = await this.db.transaction(async (tx) => {
      const current = await this.stripePayments.lockAttemptByOrder(tx, record.order.id)
      if (!current || current.id !== record.attemptId) throw new DomainError('INVALID_ORDER_COMMAND')
      if (current.stripeSessionId && current.checkoutUrl && current.expiresAt) return current
      const touched = await this.stripePayments.touchAttemptCreateCall(tx, current.id)
      if (!touched) throw new DomainError('INVALID_ORDER_COMMAND')
      return touched
    })

    let checkout = attempt.stripeSessionId && attempt.checkoutUrl && attempt.expiresAt
      ? { url: attempt.checkoutUrl, expiresAt: attempt.expiresAt }
      : null
    if (!checkout) {
      try {
        const session = await this.gateway.createCheckout({
          orderId: record.order.id,
          lines: record.order.items.map((item) => ({
            name: `${item.productName} · ${item.variantName}`,
            quantity: item.quantity,
            unitAmountSatang: item.unitPriceSatang,
          })),
          shippingSatang: record.order.shippingSatang,
          email: record.order.contactEmail,
          amountSatang: record.order.totalSatang,
          currency: 'thb',
          idempotencyKey: attempt.stripeIdempotencyKey,
        })
        const saved = await this.db.transaction((tx) => this.stripePayments.recordAttemptSession(tx, attempt.id, {
          sessionId: session.sessionId,
          url: session.url,
          expiresAt: session.expiresAt,
        }))
        if (!saved || !saved.checkoutUrl || !saved.expiresAt) throw new Error('Checkout attempt could not be updated')
        checkout = { url: saved.checkoutUrl, expiresAt: saved.expiresAt }
      } catch {
        throw new DomainError('STRIPE_CHECKOUT_UNAVAILABLE')
      }
    }

    return {
      order: record.order,
      checkout: { url: checkout.url, expiresAt: checkout.expiresAt.toISOString() },
      ...(record.guestAccessToken ? { guestAccessToken: record.guestAccessToken } : {}),
    }
  }
}
