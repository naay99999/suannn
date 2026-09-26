import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { DomainError } from '../../shared/domain-error'
import { httpModels } from '../../shared/http-model'
import type { CommerceSettingsService } from './service'
import { commerceSettingsModels } from './model'
import type { UpdateCommerceSettingsInput } from './repository'

async function parseStrictBody({ request }: { request: Request }) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !['shippingFeeSatang', 'checkoutEnabled'].includes(key))) {
    throw new DomainError('INVALID_COMMERCE_SETTINGS')
  }
  return body
}

export function createAdminCommerceSettingsModule(
  config: AppConfig,
  auth: Auth,
  service: CommerceSettingsService,
) {
  return new Elysia({ name: 'admin-commerce-settings', prefix: '/api/v1/admin/commerce-settings' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(commerceSettingsModels)
    .get('', () => service.get(), {
      permission: { settings: ['read'] },
      response: { 200: 'commerceSettings.response', 401: 'http.error', 403: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'Get commerce checkout settings',
        description: 'Returns the configured flat shipping fee, checkout switch, and version. Requires settings:read permission.',
        tags: ['Admin Commerce Settings'], security: [{ sessionCookie: [] }],
      },
    })
    .put('', ({ body, user, requestContext }) => service.update(body as UpdateCommerceSettingsInput, {
      userId: user.id,
      auditContext: {
        requestId: requestContext.requestId,
        ipAddress: requestContext.clientIp,
        userAgent: requestContext.userAgent,
      },
    }), {
      parse: [parseStrictBody, 'json'],
      browserMutation: 'admin',
      permission: { settings: ['update'] },
      body: 'commerceSettings.updateBody',
      response: { 200: 'commerceSettings.response', 401: 'http.error', 403: 'http.error', 422: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'Update commerce checkout settings',
        description: 'Sets the flat shipping fee and checkout switch. Enabling checkout requires a fee. Requires settings:update permission and an admin-origin browser request.',
        tags: ['Admin Commerce Settings'], security: [{ sessionCookie: [] }],
      },
    })
}

export * from './model'
export * from './repository'
export * from './service'
