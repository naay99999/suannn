import { describe, expect, it } from 'bun:test'
import Stripe from 'stripe'
import { createStripeClient, createStripeGateway } from '../../src/modules/payments/stripe/gateway'

const config = {
  apiKey: 'sk_test_gateway',
  webhookSecret: 'whsec_gateway',
  successUrl: 'http://localhost:5183/checkout/success?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'http://localhost:5183/checkout/cancel',
}

function createClientStub() {
  const requests: Array<{ params: Stripe.Checkout.SessionCreateParams; options?: Stripe.RequestOptions }> = []
  const coupons: Array<{ params: Stripe.CouponCreateParams; options?: Stripe.RequestOptions }> = []
  const client = {
    coupons: {
      create: async (params: Stripe.CouponCreateParams, options?: Stripe.RequestOptions) => {
        coupons.push({ params, options })
        return { id: 'coupon_test_1' }
      },
    },
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

  return { client, requests, coupons }
}

const checkoutInput = {
  orderId: 'order_123',
  lines: [{ name: 'Canvas Tote', quantity: 1, unitAmountSatang: 2_500 }],
  shippingSatang: 0,
  discountSatang: 0,
  discountName: null as string | null,
  email: 'shopper@example.com',
  amountSatang: 2_500,
  currency: 'thb' as const,
  paymentMethodType: 'card' as 'card' | 'promptpay',
  expiresAt: new Date('2026-09-27T12:30:00.000Z'),
  successUrl: config.successUrl,
  cancelUrl: config.cancelUrl,
  idempotencyKey: 'checkout-attempt_order_123',
}

describe('Stripe gateway', () => {
  it('bounds Stripe network calls so stale attempt cleanup has a finite last-call window', () => {
    const client = createStripeClient(config)

    expect(client.getApiField('timeout')).toBe(20_000)
    expect(client.getApiField('maxNetworkRetries')).toBe(2)
  })

  it('creates one THB line item for a 2,500 satang item with no shipping', async () => {
    const { client, requests } = createClientStub()
    const gateway = createStripeGateway(config, client)
    expect(gateway.checkoutReturnUrls()).toEqual({ successUrl: config.successUrl, cancelUrl: config.cancelUrl })

    await gateway.createCheckout(checkoutInput)

    const params = requests[0]!.params
    expect(params.line_items).toHaveLength(1)
    expect(params.line_items?.[0]).toMatchObject({
      quantity: 1,
      price_data: { currency: 'thb', unit_amount: 2_500 },
    })
    expect(params.mode).toBe('payment')
    expect(params.success_url).toBe(config.successUrl)
    expect(params.cancel_url).toBe(config.cancelUrl)
    expect(params.payment_method_types).toEqual(['card'])
    expect(params.automatic_tax).toBeUndefined()
  })

  it('limits the Checkout page to PromptPay when the customer chose QR', async () => {
    const { client, requests } = createClientStub()
    const gateway = createStripeGateway(config, client)

    await gateway.createCheckout({ ...checkoutInput, paymentMethodType: 'promptpay' })

    expect(requests[0]!.params.payment_method_types).toEqual(['promptpay'])
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

  it('uses the fixed expiry stored on the Checkout attempt', async () => {
    const { client, requests } = createClientStub()
    const gateway = createStripeGateway(config, client)
    await gateway.createCheckout(checkoutInput)

    const expiresAt = requests[0]!.params.expires_at!
    expect(expiresAt).toBe(Math.floor(checkoutInput.expiresAt.getTime() / 1000))
  })

  it('rejects invalid raw body webhook signatures', async () => {
    const gateway = createStripeGateway(config)

    await expect(gateway.constructEvent('not-json', 'invalid-signature')).rejects.toThrow()
  })

  it('accepts validly signed raw body webhooks', async () => {
    const gateway = createStripeGateway(config)
    const payload = JSON.stringify({ id: 'evt_test_signed', object: 'event', type: 'checkout.session.completed' })
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: config.webhookSecret })

    const event = await gateway.constructEvent(payload, signature)

    expect(event.id).toBe('evt_test_signed')
  })
  it('applies the item discount through a one-off coupon and keeps line prices undiscounted', async () => {
    const { client, requests, coupons } = createClientStub()
    const gateway = createStripeGateway(config, client)

    await gateway.createCheckout({
      ...checkoutInput,
      shippingSatang: 500,
      discountSatang: 1_000,
      discountName: 'ส่วนลด SAVE',
      amountSatang: 2_000,
    })

    expect(coupons).toHaveLength(1)
    expect(coupons[0]!.params).toEqual({
      amount_off: 1_000, currency: 'thb', duration: 'once', max_redemptions: 1, name: 'ส่วนลด SAVE',
    })
    expect(coupons[0]!.options).toEqual({ idempotencyKey: `${checkoutInput.idempotencyKey}:coupon` })
    const params = requests[0]!.params
    expect(params.discounts).toEqual([{ coupon: 'coupon_test_1' }])
    expect(params.line_items?.map((item) => item.price_data?.unit_amount)).toEqual([2_500, 500])
  })

  it('creates no coupon without a discount', async () => {
    const { client, requests, coupons } = createClientStub()
    await createStripeGateway(config, client).createCheckout(checkoutInput)
    expect(coupons).toHaveLength(0)
    expect(requests[0]!.params.discounts).toBeUndefined()
  })

  it('rejects an amount that does not equal lines plus shipping minus discount', async () => {
    const { client, coupons } = createClientStub()
    const gateway = createStripeGateway(config, client)

    await expect(gateway.createCheckout({
      ...checkoutInput, discountSatang: 1_000, discountName: 'x', amountSatang: 2_500,
    })).rejects.toThrow('Checkout amount must equal')
    expect(coupons).toHaveLength(0)
  })
})
