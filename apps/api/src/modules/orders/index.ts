import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import type { Auth } from '../../plugins/auth/auth'
import { createAuthMacros } from '../../plugins/auth'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { hashToken } from '../../shared/crypto'
import { httpModels } from '../../shared/http-model'
import { DomainError } from '../../shared/domain-error'
import type { RateLimiter } from '../rate-limit/service'
import { rateLimitResponse } from '../rate-limit/service'
import type { OrderPrincipal, OrderDetail, OrderStaffActor, OrderStatus } from './types'
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

function parseStrictJsonBody(allowedFields: readonly string[]) {
  const allowed = new Set(allowedFields)
  return async ({ request }: { request: Request }) => {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !allowed.has(key))) {
      throw new DomainError('INVALID_ORDER_COMMAND')
    }
    return body
  }
}

function staffActor(
  userId: string,
  requestContext: { requestId: string; clientIp: string; userAgent: string | null },
): OrderStaffActor {
  return {
    kind: 'staff',
    userId,
    auditContext: {
      requestId: requestContext.requestId,
      ipAddress: requestContext.clientIp,
      userAgent: requestContext.userAgent,
    },
  }
}

function staffOrderProjection(order: OrderDetail): OrderDetail {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customerId: order.customerId,
    contactEmail: order.contactEmail,
    contactPhone: order.contactPhone,
    recipientName: order.recipientName,
    addressLine1: order.addressLine1,
    addressLine2: order.addressLine2,
    subdistrict: order.subdistrict,
    district: order.district,
    province: order.province,
    postalCode: order.postalCode,
    subtotalSatang: order.subtotalSatang,
    shippingSatang: order.shippingSatang,
    totalSatang: order.totalSatang,
    currency: order.currency,
    paymentMethod: order.paymentMethod,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      sku: item.sku,
      productName: item.productName,
      variantName: item.variantName,
      unit: item.unit,
      unitPriceSatang: item.unitPriceSatang,
      quantity: item.quantity,
      lineTotalSatang: item.lineTotalSatang,
    })),
    payment: {
      id: order.payment.id,
      method: order.payment.method,
      provider: order.payment.provider,
      amountSatang: order.payment.amountSatang,
      currency: order.payment.currency,
      status: order.payment.status,
    },
  }
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
    .get('', async ({ request, query }) => {
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
        security: [{ sessionCookie: [] }, { orderAccessToken: [] }],
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
        security: [{ sessionCookie: [] }, { orderAccessToken: [] }],
      },
    })
}

export function createAdminOrdersModule(config: AppConfig, auth: Auth, service: OrderService) {
  const staffSecurity = [{ sessionCookie: [] }]
  const errors = { 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error' } as const
  const actorFrom = (userId: string, requestContext: { requestId: string; clientIp: string; userAgent: string | null }) =>
    staffActor(userId, requestContext)

  return new Elysia({ name: 'admin-orders', prefix: '/api/v1/admin/orders' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(ordersModels)
    .get('', ({ query, user, requestContext }) => service.listStaff(
      actorFrom(user.id, requestContext), query.cursor, query.limit ?? 50,
    ), {
      beforeHandle: rejectUnknownQueryFields(['cursor', 'limit']),
      permission: { order: ['read'] },
      query: 'orders.listQuery',
      response: { 200: 'orders.page', ...errors },
      detail: {
        summary: 'List staff orders',
        description: 'Returns a cursor-paginated staff view of orders. Requires order:read permission.',
        tags: ['Admin Orders'], security: staffSecurity,
      },
    })
    .get('/:orderId', async ({ params, user, requestContext }) => staffOrderProjection(await service.getForPrincipal(
      params.orderId, actorFrom(user.id, requestContext),
    )), {
      beforeHandle: rejectUnknownQueryFields([]),
      permission: { order: ['read'] },
      params: 'orders.idParams',
      response: { 200: 'orders.detail', ...errors },
      detail: {
        summary: 'Get a staff order',
        description: 'Returns an order and payment detail without any guest access secret. Requires order:read permission.',
        tags: ['Admin Orders'], security: staffSecurity,
      },
    })
    .post('/:orderId/fulfillment', async ({ params, body, user, requestContext, headers }) => staffOrderProjection(
      await service.advanceFulfillment(
        params.orderId,
        body.status as OrderStatus,
        actorFrom(user.id, requestContext),
        headers['idempotency-key'],
      ),
    ), {
      parse: [parseStrictJsonBody(['status']), 'json'],
      browserMutation: 'admin',
      permission: { order: ['fulfill'] },
      params: 'orders.idParams',
      headers: 'orders.idempotencyHeaders',
      body: 'orders.fulfillmentBody',
      response: { 200: 'orders.detail', ...errors },
      detail: {
        summary: 'Advance order fulfillment',
        description: 'Advances the order to its next fulfillment status. The command is idempotent. Requires order:fulfill permission and an admin-origin browser request.',
        tags: ['Admin Orders'], security: staffSecurity,
      },
    })
    .post('/:orderId/cancel', async ({ params, user, requestContext, headers }) => staffOrderProjection(await service.cancel(
      params.orderId,
      actorFrom(user.id, requestContext),
      headers['idempotency-key'],
    )), {
      parse: [parseEmptyBody, 'json'],
      browserMutation: 'admin',
      permission: { order: ['cancel'] },
      params: 'orders.idParams',
      headers: 'orders.idempotencyHeaders',
      body: 'orders.emptyBody',
      response: { 200: 'orders.detail', ...errors },
      detail: {
        summary: 'Cancel a staff order',
        description: 'Cancels an eligible order before shipment and restores its original inventory allocations once. Requires order:cancel permission, an idempotency key, and an admin-origin browser request.',
        tags: ['Admin Orders'], security: staffSecurity,
      },
    })
    .post('/:orderId/collect-cod', async ({ params, body, user, requestContext, headers }) => staffOrderProjection(
      await service.collectCod(
        params.orderId,
        body.amountSatang,
        actorFrom(user.id, requestContext),
        headers['idempotency-key'],
      ),
    ), {
      parse: [parseStrictJsonBody(['amountSatang']), 'json'],
      browserMutation: 'admin',
      permission: { order: ['collect'] },
      params: 'orders.idParams',
      headers: 'orders.idempotencyHeaders',
      body: 'orders.collectCodBody',
      response: { 200: 'orders.detail', ...errors },
      detail: {
        summary: 'Record COD collection',
        description: 'Records collection only when the amount equals the order total. The command is idempotent. Requires order:collect permission, an idempotency key, and an admin-origin browser request.',
        tags: ['Admin Orders'], security: staffSecurity,
      },
    })
    .post('/:orderId/guest-access/reissue', async ({ params, body, user, requestContext, headers }) => staffOrderProjection(
      await service.reissueGuestAccess(
        params.orderId,
        body.reasonCode,
        actorFrom(user.id, requestContext),
        headers['idempotency-key'],
      ),
    ), {
      parse: [parseStrictJsonBody(['reasonCode']), 'json'],
      browserMutation: 'admin',
      permission: { order: ['manage-access'] },
      params: 'orders.idParams',
      headers: 'orders.idempotencyHeaders',
      body: 'orders.guestAccessBody',
      response: { 200: 'orders.detail', ...errors },
      detail: {
        summary: 'Reissue guest order access',
        description: 'Rotates guest order access and queues a fresh confirmation email. Never returns the new access secret to staff. Requires order:manage-access permission, an idempotency key, and an admin-origin browser request.',
        tags: ['Admin Orders'], security: staffSecurity,
      },
    })
    .post('/:orderId/guest-access/revoke', async ({ params, body, user, requestContext, headers }) => staffOrderProjection(
      await service.revokeGuestAccess(
        params.orderId,
        body.reasonCode,
        actorFrom(user.id, requestContext),
        headers['idempotency-key'],
      ),
    ), {
      parse: [parseStrictJsonBody(['reasonCode']), 'json'],
      browserMutation: 'admin',
      permission: { order: ['manage-access'] },
      params: 'orders.idParams',
      headers: 'orders.idempotencyHeaders',
      body: 'orders.guestAccessBody',
      response: { 200: 'orders.detail', ...errors },
      detail: {
        summary: 'Revoke guest order access',
        description: 'Invalidates guest order access. Requires order:manage-access permission, an idempotency key, and an admin-origin browser request.',
        tags: ['Admin Orders'], security: staffSecurity,
      },
    })
}
