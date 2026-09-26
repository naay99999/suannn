import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createAuthMacros } from '../../plugins/auth'
import { createRequestContextPlugin } from '../../plugins/request-context'
import type { Auth } from '../../plugins/auth/auth'
import { httpModels } from '../../shared/http-model'
import { systemSettingsModels } from './model'
import type { SystemSettingsService } from './service'

export function createSystemSettingsModule(
  config: AppConfig,
  auth: Auth,
  service: SystemSettingsService,
) {
  return new Elysia({ name: 'system-settings', prefix: '/api/v1/settings' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(systemSettingsModels)
    .get('/security', () => service.getSecuritySettings(), {
      permission: { settings: ['read'] },
      response: { 200: 'systemSettings.securityResponse', 401: 'http.error', 403: 'http.error' },
      detail: {
        summary: 'Get system security settings',
        description: 'Returns the staff MFA enforcement policy. Requires settings:read permission.',
        tags: ['Settings'], security: [{ sessionCookie: [] }],
      },
    })
    .patch('/security', ({ body, user, requestContext }) =>
      service.setStaffMfaRequired(body.staffMfaRequired, user.id, {
        requestId: requestContext.requestId,
        ipAddress: requestContext.clientIp,
        userAgent: requestContext.userAgent,
      }), {
      browserMutation: 'admin',
      permission: { settings: ['update'] },
      body: 'systemSettings.securityBody',
      response: { 200: 'systemSettings.securityResponse', 401: 'http.error', 403: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'Update system security settings',
        description: 'Updates the staff MFA enforcement policy. Enabling enforcement revokes all staff sessions. Requires settings:update permission.',
        tags: ['Settings'], security: [{ sessionCookie: [] }],
      },
    })
}

export * from './model'
export * from './repository'
export * from './service'
