import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import type { Auth } from '../../plugins/auth/auth'
import { createRequestContextPlugin } from '../../plugins/request-context'
import type { RateLimiter } from '../rate-limit/service'
import { rateLimitResponse } from '../rate-limit/service'
import { httpModels } from '../../shared/http-model'
import { DomainError } from '../../shared/domain-error'
import type { CartService } from './service'
import { cartModels } from './model'
import { expireGuestCartCookie, readGuestCartTokenHash, resolveCartPrincipal } from './principal'

const guestMutationLimit = { limit: 30, windowSeconds: 60 }

async function rateLimitGuestMutation(
  principalKind: 'customer' | 'guest',
  limiter: Pick<RateLimiter, 'consume'>,
  requestContext: { clientIp: string },
  set: { status?: number | string; headers: Record<string, string | number> },
) {
  if (principalKind === 'customer') return null

  const result = await limiter.consume({
    namespace: 'store-cart-guest-mutation',
    subjectHash: 'storefront-guest-cart',
    ip: requestContext.clientIp,
    ...guestMutationLimit,
  })

  if (result.allowed) return null

  const rejected = rateLimitResponse(result)
  set.status = rejected.status
  Object.assign(set.headers, rejected.headers)
  return rejected.body
}

function parseSetItemBody({ request }: { request: Request }) {
  return request.json().then((body: unknown) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !('quantity' in body)) {
      throw new DomainError('INVALID_CART')
    }
    return body
  }).catch((error: unknown) => {
    if (error instanceof DomainError) throw error
    throw new DomainError('INVALID_CART')
  })
}

function parseMergeBody({ request }: { request: Request }) {
  return request.json().then((body: unknown) => {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
      throw new DomainError('INVALID_CART')
    }
    return body
  }).catch((error: unknown) => {
    if (error instanceof DomainError) throw error
    throw new DomainError('INVALID_CART')
  })
}

export function createStoreCartModule(
  config: AppConfig,
  auth: Auth,
  service: CartService,
  limiter: Pick<RateLimiter, 'consume'>,
) {
  const errors = { 401: 'http.error', 403: 'http.error', 409: 'http.error', 422: 'http.error' } as const
  const cookieSecurity = [{ sessionCookie: [] }]

  return new Elysia({ name: 'store-cart', prefix: '/api/v1/store/cart' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .model(httpModels)
    .model(cartModels)
    .get('/', async ({ request }) => {
      const { principal } = await resolveCartPrincipal(auth, request, config.secureCookies)
      return service.get(principal)
    }, {
      response: { 200: 'cart.detail', 403: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'Get the current store cart',
        description: 'Returns the signed-in customer cart or the cart associated with the guest browser cookie. An anonymous request without either returns an empty cart.',
        tags: ['Store Cart'],
        security: [],
      },
    })
    .put('/items/:variantId', async ({ request, params, body, requestContext, set }) => {
      const resolved = await resolveCartPrincipal(auth, request, config.secureCookies)
      const limited = await rateLimitGuestMutation(resolved.principal.kind, limiter, requestContext, set)
      if (limited) return limited

      const result = await service.setItem(resolved.principal, params.variantId, body.quantity)
      if (resolved.setCookie) set.headers['set-cookie'] = resolved.setCookie
      return result
    }, {
      browserMutation: 'storefront',
      parse: [parseSetItemBody, 'json'],
      params: 'cart.variantParams',
      body: 'cart.setItemBody',
      response: { 200: 'cart.detail', ...errors, 429: 'http.error' },
      detail: {
        summary: 'Set a cart item quantity',
        description: 'Sets the absolute quantity for an active product variant. Guest cart writes are rate-limited.',
        tags: ['Store Cart'],
        security: [],
      },
    })
    .delete('/items/:variantId', async ({ request, params, requestContext, set }) => {
      const resolved = await resolveCartPrincipal(auth, request, config.secureCookies)
      const limited = await rateLimitGuestMutation(resolved.principal.kind, limiter, requestContext, set)
      if (limited) return limited

      const result = await service.removeItem(resolved.principal, params.variantId)
      if (resolved.setCookie) set.headers['set-cookie'] = resolved.setCookie
      return result
    }, {
      browserMutation: 'storefront',
      params: 'cart.variantParams',
      response: { 200: 'cart.detail', ...errors, 429: 'http.error' },
      detail: {
        summary: 'Remove a cart item',
        description: 'Removes an active product variant from the current cart. Guest cart writes are rate-limited.',
        tags: ['Store Cart'],
        security: [],
      },
    })
    .post('/merge', async ({ request, requestContext, set }) => {
      const { principal } = await resolveCartPrincipal(auth, request, config.secureCookies)
      if (principal.kind !== 'customer') {
        set.status = 401
        return { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' }
      }

      const guestTokenHash = readGuestCartTokenHash(request)
      if (!guestTokenHash) return { cart: await service.get(principal), skipped: [] }

      const limited = await rateLimitGuestMutation('guest', limiter, requestContext, set)
      if (limited) return limited

      const result = await service.mergeGuest(principal.userId, guestTokenHash)
      set.headers['set-cookie'] = expireGuestCartCookie(config.secureCookies)
      return result
    }, {
      browserMutation: 'storefront',
      parse: [parseMergeBody, 'json'],
      body: 'cart.mergeBody',
      response: { 200: 'cart.mergeResponse', ...errors, 429: 'http.error' },
      detail: {
        summary: 'Merge a guest cart into the customer cart',
        description: 'Merges the guest cart identified by the browser cookie into the authenticated customer cart, then consumes that cookie.',
        tags: ['Store Cart'],
        security: cookieSecurity,
      },
    })
}
