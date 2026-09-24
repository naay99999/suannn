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
    .get('/', ({ query }) => service.list({ limit: query.limit ?? 50, cursor: query.cursor }), {
      permission: { staff: ['read'] },
      query: 'staff.listQuery',
      response: { 200: 'staff.memberList', 401: 'http.error', 403: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'List staff members',
        description: 'Requires staff:read permission. Returns up to 50 staff members by default, 100 at most; pass nextCursor as cursor for the next page.',
        tags: ['Staff Members'], security: [{ sessionCookie: [] }],
      },
    })
    .patch('/:id/role', ({ body, params, staff, user, requestContext }) =>
      service.changeRole({ id: user.id, role: staff.role, auditContext: {
        requestId: requestContext.requestId, ipAddress: requestContext.clientIp, userAgent: requestContext.userAgent,
      } }, params.id, body.role), {
      permission: { staff: ['change-role'] },
      browserMutation: 'admin',
      body: 'staff.roleBody',
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error', 429: 'http.error' },
      applicationRateLimit: { namespace: 'staff-role-change', limit: 10, windowSeconds: 60 },
      detail: {
        summary: 'Change staff member role',
        description: 'Requires staff:change-role permission. Changes the target staff member role and records an audit event.',
        tags: ['Staff Members'], security: [{ sessionCookie: [] }],
      },
    })
    .post('/:id/suspend', ({ body, params, staff, user, requestContext }) =>
      service.suspend({ id: user.id, role: staff.role, auditContext: {
        requestId: requestContext.requestId, ipAddress: requestContext.clientIp, userAgent: requestContext.userAgent,
      } }, params.id, body.reason), {
      permission: { staff: ['suspend'] },
      browserMutation: 'admin',
      body: 'staff.suspendBody',
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error', 429: 'http.error' },
      detail: {
        summary: 'Suspend staff member',
        description: 'Requires staff:suspend permission. Suspends the target staff account, revokes its sessions, and records the reason.',
        tags: ['Staff Members'], security: [{ sessionCookie: [] }],
      },
      applicationRateLimit: { namespace: 'staff-suspend', limit: 10, windowSeconds: 60 },
    })
    .post('/:id/reactivate', ({ params, staff, user, requestContext }) =>
      service.reactivate({ id: user.id, role: staff.role, auditContext: {
        requestId: requestContext.requestId, ipAddress: requestContext.clientIp, userAgent: requestContext.userAgent,
      } }, params.id), {
      permission: { staff: ['suspend'] },
      browserMutation: 'admin',
      applicationRateLimit: { namespace: 'staff-reactivate', limit: 10, windowSeconds: 60 },
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error', 429: 'http.error' },
      detail: {
        summary: 'Reactivate staff member',
        description: 'Requires staff:suspend permission. Reactivates a suspended staff account.',
        tags: ['Staff Members'], security: [{ sessionCookie: [] }],
      },
    })
    .post('/:id/sessions/revoke', ({ params, staff, user, requestContext }) =>
      service.revokeSessions({ id: user.id, role: staff.role, auditContext: {
        requestId: requestContext.requestId, ipAddress: requestContext.clientIp, userAgent: requestContext.userAgent,
      } }, params.id), {
      permission: { staff: ['revoke-session'] },
      browserMutation: 'admin',
      applicationRateLimit: { namespace: 'staff-session-revoke', limit: 10, windowSeconds: 60 },
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error', 429: 'http.error' },
      detail: {
        summary: 'Revoke all staff member sessions',
        description: 'Requires staff:revoke-session permission. Revokes every session for the target staff member.',
        tags: ['Staff Sessions'], security: [{ sessionCookie: [] }],
      },
    })
    .post('/:id/mfa/reset', ({ params, staff, user, requestContext }) =>
      service.resetMfa({ id: user.id, role: staff.role, auditContext: {
        requestId: requestContext.requestId, ipAddress: requestContext.clientIp, userAgent: requestContext.userAgent,
      } }, params.id), {
      permission: { staff: ['reset-mfa'] },
      browserMutation: 'admin',
      applicationRateLimit: { namespace: 'staff-mfa-reset', limit: 5, windowSeconds: 300 },
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error', 429: 'http.error' },
      detail: {
        summary: 'Reset staff member MFA',
        description: 'Requires staff:reset-mfa permission. Removes the target staff member MFA enrollment and revokes their sessions.',
        tags: ['Staff MFA'], security: [{ sessionCookie: [] }],
      },
    })
}

export function createStaffSessionModule(
  config: AppConfig,
  auth: Auth,
  service: StaffService,
  limiter: RateLimiter,
) {
  return new Elysia({ name: 'staff-self-sessions', prefix: '/api/v1/auth/staff' })
    .use(createBrowserMutationPlugin(config))
    .use(createAuthMacros(auth))
    .use(createApplicationRateLimitPlugin(config, limiter))
    .model(staffModels)
    .model(httpModels)
    .get('/sessions', ({ user, query }) => service.listOwnSessions(user.id, {
      limit: query.limit ?? 50,
      cursor: query.cursor,
    }), {
      staffAuth: true,
      query: 'staff.listQuery',
      response: { 200: 'staff.sessionList', 401: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'List my staff sessions',
        description: 'List active sessions for the current staff member. Expired sessions are excluded. Returns up to 50 by default, 100 at most; pass nextCursor as cursor for the next page.',
        tags: ['Staff Sessions'], security: [{ sessionCookie: [] }],
      },
    })
    .post('/sessions/:id/revoke', ({ params, user, requestContext }) =>
      service.revokeOwnSession(user.id, params.id, {
        requestId: requestContext.requestId,
        ipAddress: requestContext.clientIp,
        userAgent: requestContext.userAgent,
      }), {
      staffAuth: true,
      browserMutation: 'admin',
      applicationRateLimit: { namespace: 'staff-own-session-revoke', limit: 10, windowSeconds: 60 },
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 404: 'http.error', 422: 'http.error', 429: 'http.error' },
      detail: {
        summary: 'Revoke my staff session',
        description: 'Revoke one session belonging to the current staff member.',
        tags: ['Staff Sessions'], security: [{ sessionCookie: [] }],
      },
    })
}

export * from './model'
export * from './repository'
export * from './service'
