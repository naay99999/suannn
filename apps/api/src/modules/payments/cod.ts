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

  recordCollection(amountSatang: number, orderTotalSatang: number): { status: 'collected'; amountSatang: number } {
    if (!Number.isSafeInteger(amountSatang) || amountSatang < 0
      || !Number.isSafeInteger(orderTotalSatang) || orderTotalSatang < 0) {
      throw new DomainError('INVALID_PAYMENT_AMOUNT')
    }
    if (amountSatang !== orderTotalSatang) throw new DomainError('COD_AMOUNT_MISMATCH')
    return { status: 'collected', amountSatang }
  }
}
