import { Elysia } from 'elysia'
import type { Auth } from '../../../plugins/auth/auth'
import { createAuthMacros } from '../../../plugins/auth'
import { httpModels } from '../../../shared/http-model'
import { trackingStatusModels } from './model'
import type { TrackingStatusService } from './service'

export function createAdminTrackingStatusModule(auth: Auth, service: Pick<TrackingStatusService, 'get'>) {
  return new Elysia({ name: 'admin-tracking-status', prefix: '/api/v1/admin/integrations/tracking' })
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(trackingStatusModels)
    .get('', () => service.get(), {
      permission: { settings: ['read'] },
      response: { 200: 'trackingStatus.response', 401: 'http.error', 403: 'http.error' },
      detail: {
        summary: 'Get purchase tracking delivery status',
        description: 'Lists PostHog, Meta, TikTok, and Google Ads with whether each is configured, its last successful delivery, failures in the last 24 hours, and the latest error code. Requires settings:read permission.',
        tags: ['Admin Tracking'],
        security: [{ sessionCookie: [] }],
      },
    })
}

export * from './model'
export * from './repository'
export * from './service'
