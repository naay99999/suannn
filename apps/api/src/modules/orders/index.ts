import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import type { Auth } from '../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { hashToken } from '../../shared/crypto'
import { httpModels } from '../../shared/http-model'
import { DomainError } from '../../shared/domain-error'
import type { RateLimiter } from '../rate-limit/service'
import { rateLimitResponse } from '../rate-limit/service'
import type { OrderPrincipal } from './types'
import type { OrderService } from './service'
import { ordersModels } from './model'

const guestOrderAccessLimit = { limit: 30, windowSeconds: 60 }

function rejectUnknownQueryFields(allowed: readonly string[]) {
  const allowedFields = new Set(allowed)
  return ({ request, set }: { request: Request; set: { status?: number | string } }) => {
    for (const key of new URL(request.url).searchParams.keys()) {
      if (!allowedFields.has(key)) {
        set.status = 422
        return { code: 'INVALID_ORDER_QUERY', message: 'Order query is invalid' }
      }
    }
  }
}

async function parseEmptyBody({ request }: { request: Request }) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new DomainError('INVALID_ORDER_COMMAND')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
    throw new DomainError('INVALID_ORDER_COMMAND')
  }
  return body
}

async function resolveOrderPrincipal(auth: Auth, request: Request): Promise<{ principal: OrderPrincipal; guest: boolean }> {
  let session: Awaited<ReturnType<Auth['api']['getSession']>> = null
  try {
    session = await auth.api.getSession({ headers: request.headers })
  } catch {
    session = null
  }

  if (session?.user.accountType === 'staff') throw new Error('CUSTOMER_ACCOUNT_REQUIRED')
  if (session?.user.accountType === 'customer') {
    if (!session.user.id.trim()) throw new Error('AUTHENTICATION_REQUIRED')
    return { principal: { kind: 'customer', userId: session.user.id }, guest: false }
  }

  return {
    principal: { kind: 'guest', accessToken: request.headers.get('x-order-access-token') ?? '' },
    guest: true,
  }
}

async function requireCustomer(auth: Auth, request: Request) {
  let session: Awaited<ReturnType<Auth['api']['getSession']>> = null
  try {
    session = await auth.api.getSession({ headers: request.headers })
  } catch {
    session = null
  }

  if (!session) throw new Error('AUTHENTICATION_REQUIRED')
  if (session.user.accountType !== 'customer') throw new Error('CUSTOMER_ACCOUNT_REQUIRED')
  if (!session.user.id.trim()) throw new Error('AUTHENTICATION_REQUIRED')
  return session.user.id
}

async function rateLimitGuestOrderAccess(
  request: Request,
  limiter: Pick<RateLimiter, 'consume'>,
  requestContext: { clientIp: string },
  set: { status?: number | string; headers: Record<string, string | number> },
) {
  const token = request.headers.get('x-order-access-token') ?? ''
  const result = await limiter.consume({
    namespace: 'store-order-guest-access',
    subjectHash: hashToken(token),
    ip: requestContext.clientIp,
    ...guestOrderAccessLimit,
  })
  if (result.allowed) return null

  const rejected = rateLimitResponse(result)
  set.status = rejected.status
  Object.assign(set.headers, rejected.headers)
  return rejected.body
}

export function createStoreOrdersModule(
  config: AppConfig,
  auth: Auth,
  service: Pick<OrderService, 'listCustomer' | 'getForPrincipal' | 'cancel'>,
  limiter: Pick<RateLimiter, 'consume'>,
) {
  const errors = { 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error' } as const

  return new Elysia({ name: 'store-orders', prefix: '/api/v1/store/orders' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .model(httpModels)
    .model(ordersModels)
    .get('/', async ({ request, query }) => {
      const customerId = await requireCustomer(auth, request)
      return service.listCustomer(customerId, query.cursor, query.limit ?? 50)
    }, {
      beforeHandle: rejectUnknownQueryFields(['cursor', 'limit']),
      query: 'orders.listQuery',
      response: { 200: 'orders.page', ...errors },
      detail: {
        summary: 'List the current customer orders',
        description: 'Returns a cursor-paginated list of orders owned by the signed-in customer.',
        tags: ['Store Orders'],
        security: [{ sessionCookie: [] }],
      },
    })
    .get('/:orderId', async ({ request, params, requestContext, set }) => {
      const { principal, guest } = await resolveOrderPrincipal(auth, request)
      if (guest) {
        const limited = await rateLimitGuestOrderAccess(request, limiter, requestContext, set)
        if (limited) return limited
      }
      return service.getForPrincipal(params.orderId, principal)
    }, {
      params: 'orders.idParams',
      response: { 200: 'orders.detail', ...errors, 429: 'http.error' },
      detail: {
        summary: 'Get an owned store order',
        description: 'Returns a customer-owned order or a guest order authenticated by X-Order-Access-Token. Missing, invalid, and unknown guest orders return the same not-found response.',
        tags: ['Store Orders'],
        security: [],
        parameters: [{
          name: 'X-Order-Access-Token',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description: 'Guest order access token issued by checkout. Customer sessions always use customer ownership.',
        }],
      },
    })
    .post('/:orderId/cancel', async ({ request, params, headers, requestContext, set }) => {
      const { principal, guest } = await resolveOrderPrincipal(auth, request)
      if (guest) {
        const limited = await rateLimitGuestOrderAccess(request, limiter, requestContext, set)
        if (limited) return limited
      }
      return service.cancel(params.orderId, principal, headers['idempotency-key'])
    }, {
      parse: [parseEmptyBody, 'json'],
      browserMutation: 'storefront',
      params: 'orders.idParams',
      body: 'orders.emptyBody',
      headers: 'orders.idempotencyHeaders',
      response: { 200: 'orders.detail', ...errors, 429: 'http.error' },
      detail: {
        summary: 'Cancel an owned store order',
        description: 'Cancels an eligible customer or guest COD order before shipment. The command is idempotent and restores the original inventory allocations once.',
        tags: ['Store Orders'],
        security: [{ sessionCookie: [] }],
        parameters: [{
          name: 'X-Order-Access-Token',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description: 'Guest order access token issued by checkout. Customer sessions always use customer ownership.',
        }],
      },
    })
}
