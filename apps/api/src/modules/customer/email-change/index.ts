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
import { customerEmailChangeModels } from './model'
import type { CustomerEmailChangeService } from './service'

export function createCustomerEmailChangeModule(
  config: AppConfig,
  auth: Auth,
  service: CustomerEmailChangeService,
  limiter: RateLimiter,
) {
  return new Elysia({ name: 'customer-email-change', prefix: '/api/v1/customer' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(customerEmailChangeModels)
    .post('/email-change/request', async ({ user, session, body, requestContext, set }) => {
      const limited = await limiter.consume({
        namespace: 'customer-email-change-request',
        subjectHash: hashToken(user.id),
        ip: requestContext.clientIp,
        limit: 3,
        windowSeconds: 60 * 60,
      })
      if (!limited.allowed) {
        const rejected = rateLimitResponse(limited)
        set.status = rejected.status
        Object.assign(set.headers, rejected.headers)
        return rejected.body
      }
      return service.request({
        userId: user.id,
        sessionId: session.id,
        newEmail: body.newEmail,
        currentPassword: body.currentPassword,
        clientIp: requestContext.clientIp,
        requestId: requestContext.requestId,
      })
    }, {
      customerAuth: true,
      browserMutation: 'storefront',
      body: 'customerEmailChange.requestBody',
      response: {
        200: 'customerEmailChange.accepted',
        401: 'http.error', 403: 'http.error', 409: 'http.error',
        422: 'http.error', 429: 'http.error', 503: 'http.error',
      },
      detail: {
        summary: 'Request customer email change',
        description: 'Checks the current password and sends an eight-digit confirmation code to the new address.',
        tags: ['Customer Email Change'], security: [{ sessionCookie: [] }],
      },
    })
    .post('/email-change/confirm', async ({ user, session, body, requestContext, set }) => {
      const limited = await limiter.consume({
        namespace: 'customer-email-change-confirm',
        subjectHash: hashToken(user.id),
        ip: requestContext.clientIp,
        limit: 5,
        windowSeconds: 600,
      })
      if (!limited.allowed) {
        const rejected = rateLimitResponse(limited)
        set.status = rejected.status
        Object.assign(set.headers, rejected.headers)
        return rejected.body
      }
      return service.confirm({
        userId: user.id,
        sessionId: session.id,
        code: body.code,
        clientIp: requestContext.clientIp,
        requestId: requestContext.requestId,
      })
    }, {
      customerAuth: true,
      browserMutation: 'storefront',
      body: 'customerEmailChange.confirmBody',
      response: {
        200: 'customerEmailChange.changed',
        401: 'http.error', 403: 'http.error', 409: 'http.error', 410: 'http.error',
        422: 'http.error', 429: 'http.error', 503: 'http.error',
      },
      detail: {
        summary: 'Confirm customer email change',
        description: 'Confirms the eight-digit code, verifies the new address and revokes all customer sessions. Sign in again after success.',
        tags: ['Customer Email Change'], security: [{ sessionCookie: [] }],
      },
    })
}
