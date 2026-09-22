import { Elysia } from 'elysia'
import type { AppConfig } from '../../../config/env'
import { createBrowserMutationPlugin } from '../../../plugins/browser-mutation'
import { createAuthMacros } from '../../../plugins/auth'
import type { Auth } from '../../../plugins/auth/auth'
import { staffInvitationModels } from './model'
import type { StaffInvitationService } from './service'
import type { RateLimiter } from '../../rate-limit/service'
import { createApplicationRateLimitPlugin } from '../../../plugins/application-rate-limit'
import { httpModels } from '../../../shared/http-model'

export function createStaffInvitationModule(
  config: AppConfig,
  auth: Auth,
  service: StaffInvitationService,
  limiter: RateLimiter,
) {
  return new Elysia({ name: 'staff-invitations', prefix: '/api/v1/staff/invitations' })
    .use(createBrowserMutationPlugin(config))
    .use(createAuthMacros(auth))
    .use(createApplicationRateLimitPlugin(config, limiter))
    .model(staffInvitationModels)
    .model(httpModels)
    .get('/', () => service.list(), {
      staffAuth: true,
      permission: { staff: ['read'] },
      response: { 200: 'staffInvitation.listResponse', 401: 'http.error', 403: 'http.error' },
    })
    .post('/', ({ body, staff, user }) => service.create({
      ...body,
      inviterUserId: user.id,
      inviterRole: staff.role,
    }), {
      browserMutation: 'admin',
      staffAuth: true,
      permission: { staff: ['invite'] },
      body: 'staffInvitation.createBody',
      applicationRateLimit: { namespace: 'staff-invitation-create', limit: 10, windowSeconds: 60 },
      response: { 200: 'staffInvitation.createResponse', 401: 'http.error', 403: 'http.error', 409: 'http.error', 422: 'http.error', 429: 'http.error' },
    })
    .post('/:id/resend', ({ params, user }) => service.resend(params.id, user.id), {
      browserMutation: 'admin',
      staffAuth: true,
      permission: { staff: ['invite'] },
      applicationRateLimit: { namespace: 'staff-invitation-resend', limit: 5, windowSeconds: 60 },
      params: 'http.idParams', response: { 200: 'staffInvitation.createResponse', 401: 'http.error', 403: 'http.error', 410: 'http.error', 422: 'http.error', 429: 'http.error' },
    })
    .post('/:id/cancel', ({ params, user }) => service.cancel(params.id, user.id), {
      browserMutation: 'admin',
      staffAuth: true,
      permission: { staff: ['invite'] },
      applicationRateLimit: { namespace: 'staff-invitation-cancel', limit: 10, windowSeconds: 60 },
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 410: 'http.error', 422: 'http.error', 429: 'http.error' },
    })
    .post('/accept', async ({ body, set }) => {
      const result = await service.accept(body)
      const cookies = result.headers.getSetCookie()

      if (cookies.length > 0) {
        set.headers['set-cookie'] = cookies
      }

      return { accepted: true as const, next: 'mfa-enrollment' as const }
    }, {
      browserMutation: 'admin',
      body: 'staffInvitation.acceptBody',
      applicationRateLimit: { namespace: 'staff-invitation-accept', limit: 5, windowSeconds: 60 },
      response: { 200: 'staffInvitation.acceptResponse', 403: 'http.error', 410: 'http.error', 422: 'http.error', 429: 'http.error' },
    })
}

export * from './model'
export * from './repository'
export * from './service'
