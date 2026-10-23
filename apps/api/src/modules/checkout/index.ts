import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import type { Auth } from '../../plugins/auth/auth'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { httpModels } from '../../shared/http-model'
import { logError } from '../../shared/logger'
import { DomainError } from '../../shared/domain-error'
import type { RateLimiter } from '../rate-limit/service'
import { rateLimitResponse } from '../rate-limit/service'
import { resolveCartPrincipal } from '../cart/principal'
import type { CartPrincipal } from '../cart/types'
import type { CheckoutService } from './service'
import type { QuoteService } from './quote'
import type { StripeCheckoutService } from './stripe-service'
import type { ConsentService } from '../tracking/consent/service'
import { sanitizeTrackingContext, type PlacementTracking } from '../tracking/context'
import type { PlaceCodInput, PlaceStripeInput } from '../orders/types'
import { normalizeDiscountEmail } from '../discounts/evaluate'
import { checkoutModels } from './model'
import { ordersModels } from '../orders/model'

const guestCheckoutLimit = { limit: 30, windowSeconds: 60 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseStrictBody(allowed: readonly string[]) {
  const allowedFields = new Set(allowed)
  return async ({ request }: { request: Request }) => {
    try {
      const body: unknown = await request.json()
      if (!isRecord(body) || Object.keys(body).some((key) => !allowedFields.has(key))) {
        throw new DomainError('INVALID_ORDER_INPUT')
      }
      return body
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError('INVALID_ORDER_INPUT')
    }
  }
}

function assertStrictAddress(address: unknown) {
  if (!isRecord(address)) throw new DomainError('INVALID_ORDER_INPUT')
  const allowedAddressFields = Object.hasOwn(address, 'addressId')
    ? ['addressId']
    : ['recipientName', 'addressLine1', 'addressLine2', 'subdistrict', 'district', 'province', 'postalCode', 'phone']
  if (Object.keys(address).some((key) => !allowedAddressFields.includes(key))) {
    throw new DomainError('INVALID_ORDER_INPUT')
  }
}

async function parseStrictPlaceOrderBody({ request }: { request: Request }) {
  const body = await parseStrictBody(['quoteToken', 'paymentMethod', 'stripePaymentMethod', 'contact', 'billingAddress', 'shippingAddress', 'tracking'])({ request })
  const contact = body.contact
  if (!isRecord(contact) || Object.keys(contact).some((key) => key !== 'email')) {
    throw new DomainError('INVALID_ORDER_INPUT')
  }
  // Tracking is best effort: sanitize in place and never reject the order over it.
  const tracking = sanitizeTrackingContext(body.tracking)
  if (tracking) body.tracking = tracking
  else delete body.tracking
  assertStrictAddress(body.billingAddress)
  if (body.shippingAddress !== undefined) assertStrictAddress(body.shippingAddress)
  return body
}

async function resolveCheckoutPrincipal(auth: Auth, request: Request, secureCookies: boolean) {
  let session: Awaited<ReturnType<Auth['api']['getSession']>> = null
  try {
    session = await auth.api.getSession({ headers: request.headers })
  } catch {
    session = null
  }

  if (session?.user.accountType === 'staff') throw new Error('CUSTOMER_ACCOUNT_REQUIRED')
  if (session?.user.accountType === 'customer') {
    if (!session.user.id.trim()) throw new Error('AUTHENTICATION_REQUIRED')
    return { principal: { kind: 'customer' as const, userId: session.user.id }, emailVerified: session.user.emailVerified }
  }

  return resolveCartPrincipal(auth, request, secureCookies)
}

async function rateLimitGuestCheckout(
  principal: CartPrincipal,
  limiter: Pick<RateLimiter, 'consume'>,
  requestContext: { clientIp: string },
  set: { status?: number | string; headers: Record<string, string | number> },
) {
  if (principal.kind === 'customer') return null

  const result = await limiter.consume({
    namespace: 'store-checkout-guest',
    subjectHash: principal.tokenHash,
    ip: requestContext.clientIp,
    ...guestCheckoutLimit,
  })
  if (result.allowed) return null

  const rejected = rateLimitResponse(result)
  set.status = rejected.status
  Object.assign(set.headers, rejected.headers)
  return rejected.body
}

export function createStoreCheckoutModule(
  config: AppConfig,
  auth: Auth,
  quotes: Pick<QuoteService, 'create'>,
  checkout: Pick<CheckoutService, 'placeCod'>,
  stripeCheckout: Pick<StripeCheckoutService, 'place'> | undefined,
  limiter: Pick<RateLimiter, 'consume'>,
  consent: Pick<ConsentService, 'resolve'>,
) {
  const errors = { 401: 'http.error', 403: 'http.error', 409: 'http.error', 422: 'http.error', 503: 'http.error' } as const

  return new Elysia({ name: 'store-checkout', prefix: '/api/v1/store/checkout' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .model(httpModels)
    .model(checkoutModels)
    .model(ordersModels)
    .post('/quote', async ({ request, body, requestContext, set }) => {
      const { principal } = await resolveCheckoutPrincipal(auth, request, config.secureCookies)
      const limited = await rateLimitGuestCheckout(principal, limiter, requestContext, set)
      if (limited) return limited
      return quotes.create(principal, new Date(), { email: body.email ? normalizeDiscountEmail(body.email) : null })
    }, {
      parse: [parseStrictBody(['email']), 'json'],
      browserMutation: 'storefront',
      body: 'checkout.quoteBody',
      response: { 200: 'checkout.quote', ...errors, 429: 'http.error' },
      detail: {
        summary: 'Create a store checkout quote',
        description: 'Returns current cart prices, any applied discount and shipping with a short-lived signed quote. The optional email only evaluates a guest discount and is never stored. The quote does not reserve inventory.',
        tags: ['Store Checkout'],
        security: [],
      },
    })
    .post('/orders', async ({ request, body, headers, requestContext, set }) => {
      const resolved = await resolveCheckoutPrincipal(auth, request, config.secureCookies)
      const { principal } = resolved
      const limited = await rateLimitGuestCheckout(principal, limiter, requestContext, set)
      if (limited) return limited
      const { tracking: trackingContext, ...orderInput } = body
      const tracking: PlacementTracking = {
        context: trackingContext,
        // Fail closed: an unresolved consent snapshot means no consent, and the order still places.
        consent: await consent.resolve(trackingContext?.consentId).catch((error: unknown) => {
          logError({
            level: 'error',
            code: 'CONSENT_RESOLVE_FAILED',
            message: 'Consent could not be resolved; placing order without consent',
            requestId: requestContext.requestId,
            errorCategory: error instanceof Error ? error.name : 'UnknownError',
          })
          return { consentRecordId: null, analytics: false, marketing: false }
        }),
        clientIp: requestContext.clientIp ?? null,
        userAgent: requestContext.userAgent ?? null,
      }
      let result
      if (body.paymentMethod === 'cod') {
        if (principal.kind !== 'customer') throw new DomainError('AUTHENTICATION_REQUIRED')
        if (!('emailVerified' in resolved) || resolved.emailVerified !== true) throw new DomainError('EMAIL_VERIFICATION_REQUIRED')
        result = await checkout.placeCod(orderInput as PlaceCodInput, principal, headers['idempotency-key'], tracking)
      } else {
        if (!config.stripe || !stripeCheckout) throw new DomainError('STRIPE_NOT_CONFIGURED')
        result = await stripeCheckout.place(orderInput as PlaceStripeInput, principal, headers['idempotency-key'], tracking)
      }
      set.status = 201
      return result
    }, {
      parse: [parseStrictPlaceOrderBody, 'json'],
      browserMutation: 'storefront',
      body: 'checkout.placeOrderBody',
      headers: 'checkout.idempotencyHeaders',
      response: { 201: 'orders.createResponse', ...errors, 429: 'http.error' },
      detail: {
        summary: 'Place a store order',
        description: 'Places an idempotent customer COD or customer or guest Stripe order. COD requires a customer with a verified email (403 EMAIL_VERIFICATION_REQUIRED). Stripe orders return a hosted Checkout URL.',
        tags: ['Store Checkout'],
        security: [],
      },
    })
}
