import { describe, expect, it } from 'bun:test'
import { createApp, type AppDependencies } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import type { Auth } from '../../src/plugins/auth/auth'
import { testEnv } from '../fixtures'
import { StripeSignatureError } from '../../src/modules/payments/stripe/events'

const config = loadConfig({
  ...testEnv,
  STRIPE_API_KEY: 'rk_test_webhook',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_webhook',
  STRIPE_SUCCESS_URL: `${testEnv.STOREFRONT_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
  STRIPE_CANCEL_URL: `${testEnv.STOREFRONT_URL}/checkout/cancel`,
})

function createHarness() {
  const calls: Array<{ rawBody: string; signature: string }> = []
  const auth = {
    api: {
      generateOpenAPISchema: async () => ({ components: {}, paths: {} }),
      getSession: async () => null,
    },
    handler: async () => new Response(),
  } as unknown as Auth
  const empty = {} as never
  const dependencies = {
    auth,
    audit: empty,
    customerSignup: empty,
    customerProfile: empty,
    customerAddresses: empty,
    customerEmailChange: empty,
    staffInvitations: empty,
    staffMfa: empty,
    staff: empty,
    staffMfaRequired: async () => true,
    systemSettings: empty,
    products: empty,
    inventory: empty,
    cart: empty,
    quote: empty,
    checkout: empty,
    stripeCheckout: empty,
    stripeEvents: {
      handle: async (rawBody: string, signature: string) => {
        calls.push({ rawBody, signature })
        if (signature !== 'valid-signature') throw new StripeSignatureError()
      },
    },
    orders: empty,
    commerceSettings: empty,
    identityReservations: { findState: async () => null },
    limiter: empty,
  } as unknown as AppDependencies

  return createApp(config, dependencies).then((app) => ({ app, calls }))
}

function webhookRequest(rawBody: string, signature?: string) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (signature) headers.set('stripe-signature', signature)
  return new Request('http://localhost/api/v1/webhooks/stripe', {
    method: 'POST',
    headers,
    body: rawBody,
  })
}

describe('Stripe webhook route', () => {
  it('rejects a missing signature with 400', async () => {
    const { app } = await createHarness()
    const response = await app.handle(webhookRequest('{"id":"evt_1"}'))

    expect(response.status).toBe(400)
  })

  it('passes the original body and signature to the event service without browser headers', async () => {
    const { app, calls } = await createHarness()
    const rawBody = '{ "id": "evt_1", "note": "ข้าว" }\n'
    const response = await app.handle(webhookRequest(rawBody, 'valid-signature'))

    expect(response.status).toBe(200)
    expect(calls).toEqual([{ rawBody, signature: 'valid-signature' }])
  })

  it('rejects an invalid signature with 400', async () => {
    const { app, calls } = await createHarness()
    const response = await app.handle(webhookRequest('{"id":"evt_1"}', 'invalid-signature'))

    expect(response.status).toBe(400)
    expect(calls).toHaveLength(1)
  })
})
