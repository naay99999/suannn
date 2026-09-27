import { Elysia, t } from 'elysia'
import type { StripeEventService } from './events'
import { StripeSignatureError } from './events'

export function createStripeWebhookModule(events: Pick<StripeEventService, 'handle'> | undefined) {
  return new Elysia({ name: 'stripe-webhook', prefix: '/api/v1/webhooks' })
    .post('/stripe', async ({ request, headers, set }) => {
      if (!events) {
        set.status = 503
        return { code: 'STRIPE_NOT_CONFIGURED', message: 'Online payment is unavailable' }
      }

      const signature = headers['stripe-signature']
      if (!signature) {
        set.status = 400
        return { code: 'INVALID_STRIPE_SIGNATURE', message: 'Stripe signature is invalid' }
      }

      const rawBody = await request.text()
      try {
        await events.handle(rawBody, signature)
      } catch (error) {
        if (error instanceof StripeSignatureError) {
          set.status = 400
          return { code: 'INVALID_STRIPE_SIGNATURE', message: 'Stripe signature is invalid' }
        }
        throw error
      }
      set.status = 200
      return { received: true }
    }, {
      parse: 'none',
      response: {
        200: t.Object({ received: t.Boolean() }),
        400: t.Object({ code: t.String(), message: t.String() }),
        500: t.Object({ code: t.String(), message: t.String() }),
        503: t.Object({ code: t.String(), message: t.String() }),
      },
      detail: {
        summary: 'Receive a verified Stripe webhook event',
        description: 'Accepts signed Stripe events using the raw request body. It does not use browser authentication or mutation guards.',
        tags: ['Payments'],
        security: [],
      },
    })
}
