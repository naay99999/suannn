export type PaymentMethod = 'cod'
export type PaymentStatus = 'awaiting_collection' | 'pending' | 'paid' | 'failed' | 'void'

export interface PaymentInitialization {
  method: PaymentMethod
  provider: string
  amountSatang: number
  status: PaymentStatus
}

export interface PaymentProvider {
  readonly method: PaymentMethod
  initialPayment(amountSatang: number): PaymentInitialization
}
