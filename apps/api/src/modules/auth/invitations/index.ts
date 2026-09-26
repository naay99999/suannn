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
    .get('/', ({ query }) => service.list({
      limit: query.limit ?? 50,
      cursor: query.cursor,
      status: query.status,
    }), {
      permission: { staff: ['read'] },
      query: 'staffInvitation.listQuery',
      response: { 200: 'staffInvitation.listResponse', 401: 'http.error', 403: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'List staff invitations',
        description: 'Requires staff:read permission. Returns up to 50 invitations by default, 100 at most. Status may be pending, accepted, revoked, or expired. Pass nextCursor with the same status filter for the next page.',
        tags: ['Staff Invitations'],
        security: [{ sessionCookie: [] }],
      },
    })
    .post('/', ({ body, staff, user, requestContext }) => service.create({
      ...body,
      inviterUserId: user.id,
      inviterRole: staff.role,
      auditContext: {
        requestId: requestContext.requestId, ipAddress: requestContext.clientIp, userAgent: requestContext.userAgent,
      },
    }), {
      browserMutation: 'admin',
      permission: { staff: ['invite'] },
      body: 'staffInvitation.createBody',
      applicationRateLimit: { namespace: 'staff-invitation-create', limit: 10, windowSeconds: 60 },
      response: { 200: 'staffInvitation.createResponse', 401: 'http.error', 403: 'http.error', 409: 'http.error', 422: 'http.error', 429: 'http.error' },
      detail: {
        summary: 'Create staff invitation',
        description: 'Requires staff:invite permission. Reserves the email address and queues an invitation email.',
        tags: ['Staff Invitations'],
        security: [{ sessionCookie: [] }],
      },
    })
    .post('/:id/resend', ({ params, user, requestContext }) => service.resend(params.id, user.id, {
      requestId: requestContext.requestId, ipAddress: requestContext.clientIp, userAgent: requestContext.userAgent,
    }), {
      browserMutation: 'admin',
      permission: { staff: ['invite'] },
      applicationRateLimit: { namespace: 'staff-invitation-resend', limit: 5, windowSeconds: 60 },
      params: 'http.idParams', response: { 200: 'staffInvitation.createResponse', 401: 'http.error', 403: 'http.error', 410: 'http.error', 422: 'http.error', 429: 'http.error' },
      detail: {
        summary: 'Resend staff invitation',
        description: 'Requires staff:invite permission. Replaces the pending invitation token and queues a new email.',
        tags: ['Staff Invitations'],
        security: [{ sessionCookie: [] }],
      },
    })
    .post('/:id/cancel', ({ params, user, requestContext }) => service.cancel(params.id, user.id, {
      requestId: requestContext.requestId, ipAddress: requestContext.clientIp, userAgent: requestContext.userAgent,
    }), {
      browserMutation: 'admin',
      permission: { staff: ['invite'] },
      applicationRateLimit: { namespace: 'staff-invitation-cancel', limit: 10, windowSeconds: 60 },
      params: 'http.idParams', response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 410: 'http.error', 422: 'http.error', 429: 'http.error' },
      detail: {
        summary: 'Cancel staff invitation',
        description: 'Requires staff:invite permission. Revokes a pending invitation and releases its email reservation.',
        tags: ['Staff Invitations'],
        security: [{ sessionCookie: [] }],
      },
    })
}

export function createStaffInvitationAcceptanceModule(
  config: AppConfig,
  service: StaffInvitationService,
  limiter: RateLimiter,
) {
  return new Elysia({ name: 'staff-invitation-acceptance', prefix: '/api/v1/auth/staff/invitations' })
    .use(createBrowserMutationPlugin(config))
    .use(createApplicationRateLimitPlugin(config, limiter))
    .model(staffInvitationModels)
    .model(httpModels)
    .post('/accept', async ({ body, set, requestContext }) => {
      const result = await service.accept({ ...body, auditContext: {
        requestId: requestContext.requestId, ipAddress: requestContext.clientIp, userAgent: requestContext.userAgent,
      } })
      const cookies = result.headers.getSetCookie()

      if (cookies.length > 0) {
        set.headers['set-cookie'] = cookies
      }

      return { accepted: true as const, next: result.next }
    }, {
      browserMutation: 'admin',
      body: 'staffInvitation.acceptBody',
      applicationRateLimit: { namespace: 'staff-invitation-accept', limit: 5, windowSeconds: 60 },
      response: { 200: 'staffInvitation.acceptResponse', 403: 'http.error', 410: 'http.error', 422: 'http.error', 429: 'http.error' },
      detail: {
        summary: 'Accept staff invitation',
        description: 'Accept an invitation using its token and a password. Creates a staff account and session; staff MFA enrollment is the next step.',
        tags: ['Staff Invitations'],
        security: [],
      },
    })
}

export * from './model'
export * from './repository'
export * from './service'
