import { randomInt } from 'node:crypto'
import Stripe from 'stripe'
import type { StripeConfig } from '../../../config/env'

export const STRIPE_REQUEST_TIMEOUT_MS = 20_000
export const STRIPE_MAX_NETWORK_RETRIES = 2
// Covers three 20-second requests plus retry backoff with a conservative margin.
export const STRIPE_CREATE_REQUEST_WINDOW_MS = 2 * 60 * 1000

export interface CheckoutOrderLine {
  name: string
  quantity: number
  unitAmountSatang: number
}

export interface CheckoutSessionInput {
  orderId: string
  lines: CheckoutOrderLine[]
  shippingSatang: number
  email: string
  amountSatang: number
  currency: 'thb'
  expiresAt: Date
  successUrl: string
  cancelUrl: string
  idempotencyKey: string
}

export interface CheckoutSessionResult {
  sessionId: string
  url: string
  expiresAt: Date
}

export type CheckoutSessionStatus = 'open' | 'complete' | 'expired' | null
export type CheckoutPaymentStatus = 'paid' | 'unpaid' | 'no_payment_required' | null

export interface CheckoutSessionState {
  sessionId: string
  orderId: string | null
  amountSatang: number | null
  currency: string | null
  status: CheckoutSessionStatus
  paymentStatus: CheckoutPaymentStatus
  paymentIntentId: string | null
  expiresAt: Date | null
}

export type StripeRefundStatus = 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled'

export interface StripeRefundState {
  refundId: string
  orderId: string | null
  refundClaimId: string | null
  paymentIntentId: string | null
  amountSatang: number
  currency: string
  status: StripeRefundStatus
}

export interface StripeGateway {
  checkoutReturnUrls(): { successUrl: string; cancelUrl: string }
  createCheckout(input: CheckoutSessionInput): Promise<CheckoutSessionResult>
  retrieveCheckout(sessionId: string): Promise<CheckoutSessionState>
  createFullRefund(input: {
    orderId: string
    refundClaimId: string
    paymentIntentId: string
    idempotencyKey: string
  }): Promise<StripeRefundState>
  retrieveRefund(refundId: string): Promise<StripeRefundState>
  constructEvent(rawBody: string, signature: string): Stripe.Event
}

function randomIntegrationIdentifier() {
  return Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join('')
}

function sessionState(session: Stripe.Checkout.Session): CheckoutSessionState {
  let status: CheckoutSessionStatus = null
  if (session.status === 'open') status = 'open'
  if (session.status === 'complete') status = 'complete'
  if (session.status === 'expired') status = 'expired'

  let paymentStatus: CheckoutPaymentStatus = null
  if (session.payment_status === 'paid') paymentStatus = 'paid'
  if (session.payment_status === 'unpaid') paymentStatus = 'unpaid'
  if (session.payment_status === 'no_payment_required') paymentStatus = 'no_payment_required'

  return {
    sessionId: session.id,
    orderId: session.metadata?.orderId ?? null,
    amountSatang: session.amount_total,
    currency: session.currency,
    status,
    paymentStatus,
    paymentIntentId: typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
  }
}

function refundState(refund: Stripe.Refund): StripeRefundState {
  const status: StripeRefundStatus = refund.status === 'requires_action'
    || refund.status === 'succeeded'
    || refund.status === 'failed'
    || refund.status === 'canceled'
    || refund.status === 'pending'
    ? refund.status
    : 'pending'

  return {
    refundId: refund.id,
    orderId: refund.metadata?.orderId ?? null,
    refundClaimId: refund.metadata?.refundClaimId ?? null,
    paymentIntentId: typeof refund.payment_intent === 'string'
      ? refund.payment_intent
      : refund.payment_intent?.id ?? null,
    amountSatang: refund.amount,
    currency: refund.currency,
    status,
  }
}

function assertSatang(value: number, label: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} must be a ${allowZero ? 'non-negative' : 'positive'} integer amount in satang`)
  }
}

export function createStripeGateway(config: StripeConfig, client?: Stripe): StripeGateway {
  const stripe = client ?? createStripeClient(config)

  return {
    checkoutReturnUrls() {
      return { successUrl: config.successUrl, cancelUrl: config.cancelUrl }
    },
    async createCheckout(input) {
      if (input.lines.length === 0) {
        throw new Error('Checkout requires at least one order line')
      }

      for (const line of input.lines) {
        assertSatang(line.unitAmountSatang, 'Line unit amount')
        assertSatang(line.quantity, 'Line quantity')
      }
      assertSatang(input.shippingSatang, 'Shipping amount', true)
      assertSatang(input.amountSatang, 'Order amount')

      const expectedAmount = input.lines.reduce(
        (sum, line) => sum + line.quantity * line.unitAmountSatang,
        input.shippingSatang,
      )
      if (!Number.isSafeInteger(expectedAmount) || expectedAmount !== input.amountSatang) {
        throw new Error('Checkout amount must equal the sum of order lines and shipping')
      }

      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = input.lines.map((line) => ({
        quantity: line.quantity,
        price_data: {
          currency: input.currency,
          unit_amount: line.unitAmountSatang,
          product_data: { name: line.name },
        },
      }))

      if (input.shippingSatang > 0) {
        lineItems.push({
          quantity: 1,
          price_data: {
            currency: input.currency,
            unit_amount: input.shippingSatang,
            product_data: { name: 'Shipping' },
          },
        })
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.orderId,
        customer_email: input.email,
        metadata: { orderId: input.orderId },
        payment_intent_data: { metadata: { orderId: input.orderId } },
        line_items: lineItems,
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
      }, { idempotencyKey: input.idempotencyKey })

      if (!session.url) {
        throw new Error('Stripe did not return a Checkout URL')
      }

      return {
        sessionId: session.id,
        url: session.url,
        expiresAt: new Date(session.expires_at * 1000),
      }
    },

    async retrieveCheckout(sessionId) {
      return sessionState(await stripe.checkout.sessions.retrieve(sessionId))
    },

    async createFullRefund(input) {
      const refund = await stripe.refunds.create({
        payment_intent: input.paymentIntentId,
        metadata: {
          orderId: input.orderId,
          refundClaimId: input.refundClaimId,
        },
      }, { idempotencyKey: input.idempotencyKey })

      return refundState(refund)
    },

    async retrieveRefund(refundId) {
      return refundState(await stripe.refunds.retrieve(refundId))
    },

    constructEvent(rawBody, signature) {
      return stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret)
    },
  }
}

export function createStripeClient(config: StripeConfig): Stripe {
  return new Stripe(config.apiKey, {
    apiVersion: '2026-08-26.dahlia',
    appInfo: { name: `Suannn-${randomIntegrationIdentifier()}` },
    timeout: STRIPE_REQUEST_TIMEOUT_MS,
    maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
  })
}
