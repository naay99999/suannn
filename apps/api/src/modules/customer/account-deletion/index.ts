import { Elysia } from 'elysia'
import type { AppConfig } from '../../../config/env'
import { createAuthMacros } from '../../../plugins/auth'
import type { Auth } from '../../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../../plugins/request-context'
import { hashToken } from '../../../shared/crypto'
import { httpModels } from '../../../shared/http-model'
import type { RateLimiter } from '../../rate-limit/service'
import { rateLimitResponse } from '../../rate-limit/service'
import { customerAccountDeletionModels } from './model'
import type { CustomerAccountDeletionService } from './service'

async function parseDeletionBody({ request }: { request: Request }) {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new Error('VALIDATION_ERROR')
  }
  const raw = await request.json().catch(() => null)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).some((key) => key !== 'currentPassword')) {
    throw new Error('VALIDATION_ERROR')
  }
  return raw
}

export function createCustomerAccountDeletionModule(
  config: AppConfig,
  auth: Auth,
  service: Pick<CustomerAccountDeletionService, 'delete'>,
  limiter: Pick<RateLimiter, 'consume'>,
) {
  return new Elysia({ name: 'customer-account-deletion', prefix: '/api/v1/customer' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(customerAccountDeletionModels)
    .post('/account/deletion', async ({ user, body, requestContext, set }) => {
      const limited = await limiter.consume({
        namespace: 'customer-account-deletion',
        subjectHash: hashToken(user.id),
        ip: requestContext.clientIp,
        limit: 5,
        windowSeconds: 60 * 60,
      })
      if (!limited.allowed) {
        const rejected = rateLimitResponse(limited)
        set.status = rejected.status
        Object.assign(set.headers, rejected.headers)
        return rejected.body
      }
      return service.delete({
        userId: user.id,
        currentPassword: body.currentPassword,
        clientIp: requestContext.clientIp,
        requestId: requestContext.requestId,
      })
    }, {
      customerAuth: true,
      browserMutation: 'storefront',
      parse: [parseDeletionBody, 'json'],
      body: 'customerAccountDeletion.body',
      response: {
        200: 'customerAccountDeletion.deleted',
        401: 'http.error', 403: 'http.error', 409: 'http.error',
        422: 'http.error', 429: 'http.error', 503: 'http.error',
      },
      detail: {
        summary: 'Delete the current customer account',
        description: 'Checks the current password, then anonymizes the account: profile, addresses, cart, sessions, and sign-in credentials are removed and the email is released for a new sign-up. Order records are retained for accounting. Returns 409 ACCOUNT_HAS_OPEN_ORDERS while any order is unpaid, in progress, or in transit.',
        tags: ['Customer Account'], security: [{ sessionCookie: [] }],
      },
    })
}
