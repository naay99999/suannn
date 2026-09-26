import { DomainError } from '../../shared/domain-error'
import type { PaymentInitialization, PaymentProvider } from './types'

export class CodPaymentProvider implements PaymentProvider {
  readonly method = 'cod' as const

  initialPayment(amountSatang: number): PaymentInitialization {
    if (!Number.isSafeInteger(amountSatang) || amountSatang < 0) {
      throw new DomainError('INVALID_PAYMENT_AMOUNT')
    }
    return {
      method: this.method,
      provider: 'cod',
      amountSatang,
      status: 'awaiting_collection',
    }
  }
}
