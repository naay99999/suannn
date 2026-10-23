import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { toCartResponse } from '../cart'
import type { CartService } from '../cart/service'
import { cartModels } from '../cart/model'
import { resolveCartPrincipal } from '../cart/principal'
import type { RateLimiter } from '../rate-limit/service'
import { rateLimitResponse } from '../rate-limit/service'
import { httpModels } from '../../shared/http-model'
import { discountModels } from './model'
import type { DiscountActor, DiscountInput, DiscountService } from './service'

function actor(userId: string, context: { requestId: string; clientIp: string; userAgent: string | null }): DiscountActor {
  return { userId, auditContext: { requestId: context.requestId, ipAddress: context.clientIp, userAgent: context.userAgent } }
}

export function createAdminDiscountsModule(config: AppConfig, auth: Auth, service: DiscountService) {
  const errors = { 400: 'http.error', 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error' } as const
  const security = [{ sessionCookie: [] }]
  const tags = ['Admin Discounts']
  return new Elysia({ name: 'admin-discounts', prefix: '/api/v1/admin/discounts' })
    .use(createBrowserMutationPlugin(config)).use(createRequestContextPlugin(config)).use(createAuthMacros(auth))
    .model(httpModels).model(discountModels)
    .get('/', async () => ({ items: await service.list() }), {
      permission: { marketing: ['read'] },
      response: { 200: 'discount.adminList', ...errors },
      detail: { summary: 'List discount codes', description: 'Returns every discount code with its status, non-cancelled uses, revenue and discount given. Requires marketing:read permission.', tags, security },
    })
    .get('/:discountId', ({ params }) => service.get(params.discountId), {
      permission: { marketing: ['read'] }, params: 'discount.idParams',
      response: { 200: 'discount.adminDetail', ...errors },
      detail: { summary: 'Get a discount code', description: 'Returns one discount code with its latest 20 non-cancelled orders. Requires marketing:read permission.', tags, security },
    })
    .post('/', async ({ body, user, requestContext, set }) => {
      set.status = 201
      return service.create(body as DiscountInput, actor(user.id, requestContext))
    }, {
      browserMutation: 'admin', permission: { marketing: ['update'] }, body: 'discount.createBody',
      response: { 201: 'discount.adminDetail', ...errors },
      detail: { summary: 'Create a discount code', description: 'Codes are stored upper case and emails lower case. Requires marketing:update permission.', tags, security },
    })
    .put('/:discountId', ({ params, body, user, requestContext }) =>
      service.update(params.discountId, body as DiscountInput & { version: number }, actor(user.id, requestContext)), {
      browserMutation: 'admin', permission: { marketing: ['update'] }, params: 'discount.idParams', body: 'discount.updateBody',
      response: { 200: 'discount.adminDetail', ...errors },
      detail: { summary: 'Replace a discount code', description: 'Requires the current version. Code and type cannot change once any order has used the code. Requires marketing:update permission.', tags, security },
    })
    .delete('/:discountId', async ({ params, user, requestContext, set }) => {
      await service.remove(params.discountId, actor(user.id, requestContext))
      set.status = 204
    }, {
      browserMutation: 'admin', permission: { marketing: ['update'] }, params: 'discount.idParams',
      response: { 204: 'http.empty', ...errors },
      detail: { summary: 'Delete an unused discount code', description: 'Fails with 409 once any order references the code; pause it instead. Requires marketing:update permission.', tags, security },
    })
}

export function createStoreCartDiscountModule(
  config: AppConfig,
  auth: Auth,
  carts: Pick<CartService, 'get' | 'setDiscountCode'>,
  discounts: Pick<DiscountService, 'resolveForApply' | 'describeForCart'>,
  limiter: Pick<RateLimiter, 'consume'>,
) {
  const errors = { 401: 'http.error', 403: 'http.error', 409: 'http.error' } as const
  const tags = ['Store Cart']
  return new Elysia({ name: 'store-cart-discount', prefix: '/api/v1/store/cart/discount' })
    .use(createBrowserMutationPlugin(config)).use(createRequestContextPlugin(config))
    .model(httpModels).model(cartModels)
    .put('/', async ({ request, body, requestContext, set }) => {
      const limited = await limiter.consume({
        namespace: 'discount-apply',
        subjectHash: 'discount-apply',
        ip: requestContext.clientIp,
        limit: 20,
        windowSeconds: 600,
      })
      if (!limited.allowed) {
        const rejected = rateLimitResponse(limited)
        set.status = rejected.status
        Object.assign(set.headers, rejected.headers)
        return rejected.body
      }

      const resolved = await resolveCartPrincipal(auth, request, config.secureCookies)
      const current = await carts.get(resolved.principal)
      const result = await discounts.resolveForApply(resolved.principal, current, body.code)
      if (!result.ok) {
        set.status = 422
        return { code: 'DISCOUNT_CODE_REJECTED' as const, message: 'Discount code cannot be used', reason: result.reason }
      }
      const updated = await carts.setDiscountCode(resolved.principal, result.ruleId)
      if (resolved.setCookie) set.headers['set-cookie'] = resolved.setCookie
      return toCartResponse(discounts, resolved.principal, updated)
    }, {
      browserMutation: 'storefront',
      body: 'cart.discountBody',
      response: { 200: 'cart.detail', 422: 'cart.discountRejected', 429: 'http.error', ...errors },
      detail: {
        summary: 'Apply a discount code to the cart',
        description: 'Attaches the code to the current cart. Unknown, not-yet-started, expired and used-up codes answer 422 DISCOUNT_CODE_REJECTED with a reason; other codes attach and the returned discount shows whether they currently apply. Limited to 20 attempts per 10 minutes per client.',
        tags, security: [],
      },
    })
    .delete('/', async ({ request, set }) => {
      const resolved = await resolveCartPrincipal(auth, request, config.secureCookies)
      const updated = await carts.setDiscountCode(resolved.principal, null)
      if (resolved.setCookie) set.headers['set-cookie'] = resolved.setCookie
      return toCartResponse(discounts, resolved.principal, updated)
    }, {
      browserMutation: 'storefront',
      response: { 200: 'cart.detail', ...errors },
      detail: {
        summary: 'Remove the discount code from the cart',
        description: 'Detaches any discount code from the current cart and returns the cart.',
        tags, security: [],
      },
    })
}

export { DiscountRepository } from './repository'
export { DiscountService } from './service'
export { discountModels } from './model'
