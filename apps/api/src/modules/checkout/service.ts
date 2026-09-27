import type { Database } from '../../database/types'
import { DomainError } from '../../shared/domain-error'
import type { CartPrincipal } from '../cart/types'
import type { CheckoutResult, PlaceCodInput } from '../orders/types'
import { runOrderCommand } from '../orders/operation'
import {
  createPlaceOrderInTransaction,
  normalizeCheckoutInput,
  placementResultPayload,
  replayPlacedOrderRecord,
} from './placement'
import { StripePaymentRepository } from '../payments/stripe/repository'

const commandName = 'checkout.place-cod'

export class CheckoutService {
  private readonly placeOrderInTransaction

  constructor(
    private readonly db: Database,
    private readonly secret: Uint8Array,
    nowOverride?: () => Date,
  ) {
    this.placeOrderInTransaction = createPlaceOrderInTransaction(
      secret,
      new StripePaymentRepository(db),
      nowOverride,
    )
  }

  async placeCod(input: PlaceCodInput, principal: CartPrincipal, idempotencyKey: string): Promise<CheckoutResult> {
    const normalized = normalizeCheckoutInput(input)
    const payload = {
      quoteToken: normalized.quoteToken,
      paymentMethod: normalized.paymentMethod,
      contact: normalized.contact,
      address: normalized.address,
    }
    return runOrderCommand<CheckoutResult>(this.db, {
      scope: principalScope(principal),
      command: commandName,
      idempotencyKey,
      payload,
    }, async (_tx, operation) => {
      const record = replayPlacedOrderRecord(operation, principal, this.secret)
      if (record.order.paymentMethod !== 'cod' || record.attemptId !== null) {
        throw new DomainError('INVALID_ORDER_COMMAND')
      }
      return record.guestAccessToken
        ? { order: record.order, guestAccessToken: record.guestAccessToken }
        : { order: record.order }
    }, async (tx, requestHash) => {
      const record = await this.placeOrderInTransaction(tx, normalized, principal, requestHash, 'cod')
      const value = record.guestAccessToken
        ? { order: record.order, guestAccessToken: record.guestAccessToken }
        : { order: record.order }
      return {
        orderId: record.order.id,
        httpStatus: 201,
        resultPayload: placementResultPayload(record),
        value,
      }
    })
  }
}

export function principalScope(principal: CartPrincipal) {
  if (principal?.kind === 'customer' && typeof principal.userId === 'string' && principal.userId.trim()) {
    return `customer:${principal.userId}`
  }
  if (principal?.kind === 'guest' && typeof principal.tokenHash === 'string' && /^[0-9a-f]{64}$/i.test(principal.tokenHash)) {
    return `guest:${principal.tokenHash.toLowerCase()}`
  }
  throw new DomainError('INVALID_ORDER_INPUT')
}
