import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import type { Auth } from '../../plugins/auth/auth'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { httpModels } from '../../shared/http-model'
import { DomainError } from '../../shared/domain-error'
import type { RateLimiter } from '../rate-limit/service'
import { rateLimitResponse } from '../rate-limit/service'
import { resolveCartPrincipal } from '../cart/principal'
import type { CartPrincipal } from '../cart/types'
import type { CheckoutService } from './service'
import type { QuoteService } from './quote'
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

async function parseStrictPlaceOrderBody({ request }: { request: Request }) {
  const body = await parseStrictBody(['quoteToken', 'paymentMethod', 'contact', 'address'])({ request })
  const contact = body.contact
  const address = body.address
  if (!isRecord(contact) || Object.keys(contact).some((key) => key !== 'email' && key !== 'phone')) {
    throw new DomainError('INVALID_ORDER_INPUT')
  }
  if (!isRecord(address)) throw new DomainError('INVALID_ORDER_INPUT')
  const allowedAddressFields = Object.hasOwn(address, 'addressId')
    ? ['addressId']
    : ['recipientName', 'addressLine1', 'addressLine2', 'subdistrict', 'district', 'province', 'postalCode']
  if (Object.keys(address).some((key) => !allowedAddressFields.includes(key))) {
    throw new DomainError('INVALID_ORDER_INPUT')
  }
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
    return { principal: { kind: 'customer' as const, userId: session.user.id } }
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
  limiter: Pick<RateLimiter, 'consume'>,
) {
  const errors = { 401: 'http.error', 403: 'http.error', 409: 'http.error', 422: 'http.error' } as const

  return new Elysia({ name: 'store-checkout', prefix: '/api/v1/store/checkout' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .model(httpModels)
    .model(checkoutModels)
    .model(ordersModels)
    .post('/quote', async ({ request, requestContext, set }) => {
      const { principal } = await resolveCheckoutPrincipal(auth, request, config.secureCookies)
      const limited = await rateLimitGuestCheckout(principal, limiter, requestContext, set)
      if (limited) return limited
      return quotes.create(principal, new Date())
    }, {
      parse: [parseStrictBody([]), 'json'],
      browserMutation: 'storefront',
      body: 'checkout.emptyBody',
      response: { 200: 'checkout.quote', ...errors, 429: 'http.error' },
      detail: {
        summary: 'Create a store checkout quote',
        description: 'Returns current cart prices and shipping with a short-lived signed quote. The quote does not reserve inventory.',
        tags: ['Store Checkout'],
        security: [],
      },
    })
    .post('/orders', async ({ request, body, headers, requestContext, set }) => {
      const { principal } = await resolveCheckoutPrincipal(auth, request, config.secureCookies)
      const limited = await rateLimitGuestCheckout(principal, limiter, requestContext, set)
      if (limited) return limited
      const result = await checkout.placeCod(body, principal, headers['idempotency-key'])
      set.status = 201
      return result
    }, {
      parse: [parseStrictPlaceOrderBody, 'json'],
      browserMutation: 'storefront',
      body: 'checkout.placeOrderBody',
      headers: 'checkout.idempotencyHeaders',
      response: { 201: 'orders.createResponse', ...errors, 429: 'http.error' },
      detail: {
        summary: 'Place a COD store order',
        description: 'Places an idempotent cash-on-delivery order from the customer or guest cart. A guest access token is returned only to a guest checkout.',
        tags: ['Store Checkout'],
        security: [],
      },
    })
}
