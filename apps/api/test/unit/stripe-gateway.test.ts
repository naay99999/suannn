import { describe, expect, it } from 'bun:test'
import Stripe from 'stripe'
import { createStripeGateway } from '../../src/modules/payments/stripe/gateway'

const config = {
  apiKey: 'sk_test_gateway',
  webhookSecret: 'whsec_gateway',
  successUrl: 'http://localhost:5183/checkout/success?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'http://localhost:5183/checkout/cancel',
}

function createClientStub() {
  const requests: Array<{ params: Stripe.Checkout.SessionCreateParams; options?: Stripe.RequestOptions }> = []
  const client = {
    checkout: {
      sessions: {
        create: async (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => {
          requests.push({ params, options })
          return {
            id: 'cs_test_123',
            url: 'https://checkout.stripe.com/c/pay/test',
            expires_at: params.expires_at,
          }
        },
      },
    },
  } as unknown as Stripe

  return { client, requests }
}

const checkoutInput = {
  orderId: 'order_123',
  lines: [{ name: 'Canvas Tote', quantity: 1, unitAmountSatang: 2_500 }],
  shippingSatang: 0,
  email: 'shopper@example.com',
  amountSatang: 2_500,
  currency: 'thb' as const,
  idempotencyKey: 'checkout-attempt_order_123',
}

describe('Stripe gateway', () => {
  it('creates one THB line item for a 2,500 satang item with no shipping', async () => {
    const { client, requests } = createClientStub()
    const gateway = createStripeGateway(config, client)

    await gateway.createCheckout(checkoutInput)

    const params = requests[0]!.params
    expect(params.line_items).toHaveLength(1)
    expect(params.line_items?.[0]).toMatchObject({
      quantity: 1,
      price_data: { currency: 'thb', unit_amount: 2_500 },
    })
    expect(params.mode).toBe('payment')
    expect(params.payment_method_types).toBeUndefined()
    expect(params.automatic_tax).toBeUndefined()
  })

  it('adds shipping as a separate line item when its amount is positive', async () => {
    const { client, requests } = createClientStub()
    const gateway = createStripeGateway(config, client)

    await gateway.createCheckout({
      ...checkoutInput,
      shippingSatang: 500,
      amountSatang: 3_000,
    })

    const lineItems = requests[0]!.params.line_items!
    expect(lineItems).toHaveLength(2)
    expect(lineItems.map((item) => item.price_data?.unit_amount)).toEqual([2_500, 500])
    expect(lineItems.every((item) => item.price_data?.currency === 'thb')).toBe(true)
    expect(lineItems.every((item) => Number.isInteger(item.price_data?.unit_amount))).toBe(true)
  })

  it('sets Checkout expiry 30 minutes from creation', async () => {
    const { client, requests } = createClientStub()
    const gateway = createStripeGateway(config, client)
    const before = Math.floor(Date.now() / 1000)

    await gateway.createCheckout(checkoutInput)

    const expiresAt = requests[0]!.params.expires_at!
    expect(expiresAt).toBeGreaterThanOrEqual(before + 1_798)
    expect(expiresAt).toBeLessThanOrEqual(before + 1_802)
  })

  it('rejects invalid raw body webhook signatures', () => {
    const gateway = createStripeGateway(config)

    expect(() => gateway.constructEvent('not-json', 'invalid-signature')).toThrow()
  })
})
