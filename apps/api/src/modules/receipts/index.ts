import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { DomainError } from '../../shared/domain-error'
import { httpModels } from '../../shared/http-model'
import { receiptSettingsFields, receiptSettingsModels } from './model'
import type { ReceiptSettingsService, UpdateReceiptSettingsInput } from './settings'

async function parseStrictBody({ request }: { request: Request }) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !(receiptSettingsFields as readonly string[]).includes(key))) {
    throw new DomainError('INVALID_RECEIPT_SETTINGS')
  }
  return body
}

export function createAdminReceiptSettingsModule(
  config: AppConfig,
  auth: Auth,
  service: ReceiptSettingsService,
) {
  return new Elysia({ name: 'admin-receipt-settings', prefix: '/api/v1/admin/receipt-settings' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(receiptSettingsModels)
    .get('', () => service.get(), {
      permission: { settings: ['read'] },
      response: { 200: 'receiptSettings.response', 401: 'http.error', 403: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'Get receipt seller settings',
        description: 'Returns the seller details printed on receipts, the VAT rate, completeness, and version. Requires settings:read permission.',
        tags: ['Admin Receipt Settings'], security: [{ sessionCookie: [] }],
      },
    })
    .put('', ({ body, user, requestContext }) => service.update(body as UpdateReceiptSettingsInput, {
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
      body: 'receiptSettings.updateBody',
      response: { 200: 'receiptSettings.response', 401: 'http.error', 403: 'http.error', 422: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'Update receipt seller settings',
        description: 'Replaces the seller details printed on receipts. A bad tax ID, branch code, or postal code returns 422. Requires settings:update permission and an admin-origin browser request.',
        tags: ['Admin Receipt Settings'], security: [{ sessionCookie: [] }],
      },
    })
}

export * from './model'
export * from './settings'
export * from './tax-id'
