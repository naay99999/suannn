import { Elysia } from 'elysia'
import type { AppConfig } from '../../../config/env'
import { createAuthMacros } from '../../../plugins/auth'
import type { Auth } from '../../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../../plugins/browser-mutation'
import { staffModels } from './model'
import type { StaffService } from './service'
import type { RateLimiter } from '../../rate-limit/service'
import { createApplicationRateLimitPlugin } from '../../../plugins/application-rate-limit'
import { httpModels } from '../../../shared/http-model'

export function createStaffModule(
  config: AppConfig,
  auth: Auth,
  service: StaffService,
  limiter: RateLimiter,
) {
  return new Elysia({ name: 'staff-admin', prefix: '/api/v1/staff' })
    .use(createBrowserMutationPlugin(config))
    .use(createAuthMacros(auth))
    .use(createApplicationRateLimitPlugin(config, limiter))
    .model(staffModels)
    .model(httpModels)
    .onError(({ error, set }) => {
      if (error instanceof Error && error.message === 'OWNER_INVARIANT') {
        set.status = 409
        return { code: 'OWNER_INVARIANT', message: 'At least one active owner is required' }
      }
    })
    .get('/sessions', ({ user }) => service.listOwnSessions(user.id), {
      staffAuth: true,
      response: { 200: 'staff.sessionList', 401: 'http.error' },
    })
    .post('/sessions/:id/revoke', ({ params, user }) =>
      service.revokeOwnSession(user.id, params.id), {
      staffAuth: true,
      browserMutation: 'admin',
      applicationRateLimit: { namespace: 'staff-own-session-revoke', limit: 10, windowSeconds: 60 },
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 404: 'http.error', 422: 'http.error', 429: 'http.error' },
    })
    .get('/', () => service.list(), {
      permission: { staff: ['read'] },
      response: { 200: 'staff.memberList', 401: 'http.error', 403: 'http.error' },
    })
    .patch('/:id/role', ({ body, params, staff, user }) =>
      service.changeRole({ id: user.id, role: staff.role }, params.id, body.role), {
      permission: { staff: ['change-role'] },
      browserMutation: 'admin',
      body: 'staff.roleBody',
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error', 429: 'http.error' },
      applicationRateLimit: { namespace: 'staff-role-change', limit: 10, windowSeconds: 60 },
    })
    .post('/:id/suspend', ({ body, params, staff, user }) =>
      service.suspend({ id: user.id, role: staff.role }, params.id, body.reason), {
      permission: { staff: ['suspend'] },
      browserMutation: 'admin',
      body: 'staff.suspendBody',
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error', 429: 'http.error' },
      applicationRateLimit: { namespace: 'staff-suspend', limit: 10, windowSeconds: 60 },
    })
    .post('/:id/reactivate', ({ params, staff, user }) =>
      service.reactivate({ id: user.id, role: staff.role }, params.id), {
      permission: { staff: ['suspend'] },
      browserMutation: 'admin',
      applicationRateLimit: { namespace: 'staff-reactivate', limit: 10, windowSeconds: 60 },
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error', 429: 'http.error' },
    })
    .post('/:id/sessions/revoke', ({ params, staff, user }) =>
      service.revokeSessions({ id: user.id, role: staff.role }, params.id), {
      permission: { staff: ['revoke-session'] },
      browserMutation: 'admin',
      applicationRateLimit: { namespace: 'staff-session-revoke', limit: 10, windowSeconds: 60 },
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error', 429: 'http.error' },
    })
    .post('/:id/mfa/reset', ({ params, staff, user }) =>
      service.resetMfa({ id: user.id, role: staff.role }, params.id), {
      permission: { staff: ['reset-mfa'] },
      browserMutation: 'admin',
      applicationRateLimit: { namespace: 'staff-mfa-reset', limit: 5, windowSeconds: 300 },
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error', 429: 'http.error' },
    })
}

export * from './model'
export * from './repository'
export * from './service'
